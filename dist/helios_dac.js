/*
SDK for Helios Laser DAC class, SOURCE
By Paul van Dinther
based on the SDK from Gitle Mikkelsen

Dependencies:
WebUSB API

Standard: ES6+
*/

// Constants
const HELIOS_SDK_VERSION = 11;

export const HELIOS_MAX_POINTS = 0xFFF;
const HELIOS_MAX_RATE = 0xFFFF;
const HELIOS_MIN_RATE = 7;

const HELIOS_SUCCESS = 1;
const HELIOS_FAIL = 0;
const HELIOS_ERROR = -1;

const HELIOS_FLAGS_DEFAULT = 0;
const HELIOS_FLAGS_START_IMMEDIATELY = (1 << 0); //  start output immediately, instead of waiting for current frame (if there is one) to finish playing
const HELIOS_FLAGS_SINGLE_MODE = (1 << 1);       //  play frame only once, instead of repeating until another frame is written

// USB properties
const HELIOS_VID = 0x1209;
const HELIOS_PID = 0xE500;

const MAX_GET_STATUS_RETRIES = 3;
const CONTROL_RESPONSE_SIZE = 32; //  all interrupt IN responses are 32-byte packets
const TRANSFER_TIMEOUT_MS = 16;   //  WebUSB has no built-in timeout; race every transferIn against this

const EP_BULK_OUT = 0x02;
const EP_BULK_IN = 0x81;
const EP_INT_OUT = 0x06;
const EP_INT_IN = 0x03;

const HELIOS_STOP_COMMAND = 0x01;
const HELIOS_SET_SHUTTER_COMMAND = 0x02;
const HELIOS_GET_STATUS_COMMAND = 0x03;
const HELIOS_GET_FIRMWARE_VERSION_COMMAND = 0x04;
const HELIOS_GET_NAME_COMMAND = 0x05;
const HELIOS_SET_NAME_COMMAND = 0x06;
const HELIOS_SEND_SDK_VERSION_COMMAND = 0x07;
const HELIOS_ERASE_FIRMWARE_COMMAND = 0xDE;

const HELIOS_STATUS_RESPONSE_CODE = 0x83;
const HELIOS_FIRMWARE_VERSION_RESPONSE_CODE = 0x84;
const HELIOS_GET_NAME_RESPONSE_CODE = 0x85;

// Point data structure
export class HeliosPoint {
    constructor(x = 0, y = 0, r = 0, g = 0, b = 0, i) {
        this.x = x;
        this.y = y;
        this.r = r;
        this.g = g;
        this.b = b;
        this.i = (i === undefined) ? (r | g | b) == 0 ? 0 : 255 : i;
    }
}

export async function connectHeliosDevice() {
    let usbDevice = await navigator.usb.requestDevice({ filters: [{ vendorId: HELIOS_VID, productId: HELIOS_PID }] });
    if (usbDevice) {
        return new HeliosDevice(usbDevice);
    }
    return null;
}

export async function getHeliosDevices() {
    let devices = await navigator.usb.getDevices();
    let heliosDevices = [];
    for (const usbDevice of devices) {
        if (usbDevice.vendorId === HELIOS_VID && usbDevice.productId === HELIOS_PID) {
            heliosDevices.push(new HeliosDevice(usbDevice));
        }
    }
    return heliosDevices;
}

export class HeliosDevice {
    #running = false;
    #firmwareVersion;
    #name;
    #pps;
    #lastPoint = null;

    constructor(usbDevice, pps = 30000) {
        this.usbDevice = usbDevice;
        this.frameReady = false;
        this.closed = true;
        this.#firmwareVersion = 0;
        this.#name = '';
        this.#pps = pps;
        this.onFrame = null;
        this.frameBuffer = new Uint8Array(HELIOS_MAX_POINTS * 7 + 5);
    }

    #DataViewToString(dataView, offset = 1) {
        let o = Math.min(offset, dataView.byteLength);
        let result = '';
        for (let i = o; i < dataView.byteLength; i++) {
            if (dataView.getUint8(i) == 0) return result;
            result += String.fromCharCode(dataView.getUint8(i));
        }
        return result;
    }

    //  WebUSB transferIn has no timeout parameter; race it against a timer so the play loop can't hang forever.
    async #transferInWithTimeout(endpoint, length, ms = TRANSFER_TIMEOUT_MS) {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('USB transferIn timeout')), ms));
        return Promise.race([this.usbDevice.transferIn(endpoint, length), timeout]);
    }

    async connect() {
        try {
            await this.usbDevice.open();
            await this.usbDevice.selectConfiguration(1);
            await this.usbDevice.claimInterface(0);
            await this.usbDevice.selectAlternateInterface(0, 1);
            await new Promise(resolve => setTimeout(resolve, 100)); //  device needs settling time before first command
            await this.init();
        } catch (error) {
            console.error('Connect failed:', error);
            return HELIOS_ERROR;
        }
    }

    async init() {
        this.closed = false;
        await this.#getFirmwareVersion();
        await this.#sendSDKVersion();
        await this.#getName();
    }

    async sendControl(buffer, receiveLength = CONTROL_RESPONSE_SIZE) {
        try {
            await this.usbDevice.transferOut(EP_INT_OUT, buffer);
            return await this.#transferInWithTimeout(EP_INT_IN, receiveLength);
        } catch (error) {
            return HELIOS_ERROR;
        }
    }

    async sendFrame(points = null, pps = 30000, singleShot = false, interuptFrame = false, enabled = true) {
        if (this.closed) return HELIOS_ERROR;
        if (points == null ||
            points.length > HELIOS_MAX_POINTS ||
            this.frameReady) return HELIOS_ERROR;

        let bufPos = 0;
        pps = (pps > 0) ? Math.min(Math.max(HELIOS_MIN_RATE, pps), HELIOS_MAX_RATE) : this.#pps;
        let ppsActual = pps;
        let numOfPointsActual = points.length;
        if (((points.length - 45) % 64) === 0) {
            numOfPointsActual--;
            //  adjust pps to keep the same frame duration even with one less point
            ppsActual = Math.round(pps * (numOfPointsActual / points.length));
        }
        let flags = HELIOS_FLAGS_DEFAULT;
        if (singleShot) flags = flags | HELIOS_FLAGS_SINGLE_MODE;
        if (interuptFrame) flags = flags | HELIOS_FLAGS_START_IMMEDIATELY;
        for (let i = 0; i < points.length; i++) {
            this.frameBuffer[bufPos++] = points[i].x >> 4;
            this.frameBuffer[bufPos++] = ((points[i].x & 0x0F) << 4) | (points[i].y >> 8);
            this.frameBuffer[bufPos++] = points[i].y & 0xFF;
            this.frameBuffer[bufPos++] = points[i].r;
            this.frameBuffer[bufPos++] = points[i].g;
            this.frameBuffer[bufPos++] = points[i].b;
            this.frameBuffer[bufPos++] = points[i].i;
        }
        this.#lastPoint = points[points.length - 1];
        this.frameBuffer[bufPos++] = ppsActual & 0xFF;
        this.frameBuffer[bufPos++] = ppsActual >> 8;
        this.frameBuffer[bufPos++] = numOfPointsActual & 0xFF;
        this.frameBuffer[bufPos++] = numOfPointsActual >> 8;
        this.frameBuffer[bufPos++] = flags;
        if (!enabled) return HELIOS_SUCCESS;
        try {
            this.frameReady = true;
            await this.usbDevice.transferOut(EP_BULK_OUT, this.frameBuffer.slice(0, bufPos));
            return HELIOS_SUCCESS;
        } catch (error) {
            console.error('Error sending frame:', error);
            return HELIOS_ERROR;
        } finally {
            this.frameReady = false;
        }
    }

    async #playloop() {
        this.#running = true;
        while (!this.closed && this.#running) {
            let ready = await this.getStatus();
            if (ready === HELIOS_SUCCESS) {
                if (this.onFrame) {
                    await this.onFrame(this, this.#lastPoint);
                }
            }
        }
    }

    async #getFirmwareVersion() {
        if (this.closed) return HELIOS_ERROR;
        const buffer = new Uint8Array(2);
        buffer[0] = HELIOS_GET_FIRMWARE_VERSION_COMMAND;
        buffer[1] = 0;
        try {
            let retry = 3;
            while (retry > 0) {
                const result = await this.sendControl(buffer);
                if (result !== HELIOS_ERROR && result.status === 'ok' && result.data &&
                    result.data.byteLength >= 5 &&
                    result.data.getUint8(0) === HELIOS_FIRMWARE_VERSION_RESPONSE_CODE) {
                    //  firmware version is a 32-bit little-endian integer in bytes 1-4
                    this.#firmwareVersion =
                        result.data.getUint8(1) |
                        (result.data.getUint8(2) << 8) |
                        (result.data.getUint8(3) << 16) |
                        (result.data.getUint8(4) << 24);
                    return this.#firmwareVersion;
                }
                retry--;
            }
            return HELIOS_ERROR;
        } catch (error) {
            console.error('Error getting firmware version:', error);
            return HELIOS_ERROR;
        }
    }

    async #sendSDKVersion() {
        if (this.closed) return HELIOS_ERROR;
        const buffer = new Uint8Array(2);
        buffer[0] = HELIOS_SEND_SDK_VERSION_COMMAND;
        buffer[1] = HELIOS_SDK_VERSION;
        try {
            let retry = 2;
            while (retry > 0) {
                const result = await this.sendControl(buffer);
                if (result !== HELIOS_ERROR && result.status === 'ok') return HELIOS_SUCCESS;
                retry--;
            }
            return HELIOS_ERROR;
        } catch (error) {
            return HELIOS_ERROR;
        }
    }

    async #getName() {
        if (this.closed) return HELIOS_ERROR;
        const buffer = new Uint8Array(2);
        buffer[0] = HELIOS_GET_NAME_COMMAND;
        buffer[1] = 0;
        try {
            let retry = 3;
            while (retry > 0) {
                const result = await this.sendControl(buffer);
                if (result !== HELIOS_ERROR && result.status === 'ok' && result.data &&
                    result.data.byteLength >= 3 &&
                    result.data.getUint8(0) === HELIOS_GET_NAME_RESPONSE_CODE) {
                    this.#name = this.#DataViewToString(result.data, 1);
                    return this.#name;
                }
                retry--;
            }
            return HELIOS_ERROR;
        } catch (error) {
            console.error('Error getting name:', error);
            return HELIOS_ERROR;
        }
    }

    async #setName(name) {
        if (this.closed) return HELIOS_ERROR;
        try {
            const buffer = new Uint8Array(32);
            buffer[0] = HELIOS_SET_NAME_COMMAND;
            new TextEncoder().encodeInto(name.substr(0, 31), buffer.subarray(1));
            const result = await this.sendControl(buffer);
            if (result !== HELIOS_ERROR && result.status === 'ok') {
                this.#name = name.substr(0, 31);
                return HELIOS_SUCCESS;
            }
            return HELIOS_FAIL;
        } catch (error) {
            console.error('Error setting name:', error);
            return HELIOS_ERROR;
        }
    }

    //  Returns HELIOS_SUCCESS if DAC is ready to receive a frame, HELIOS_FAIL if busy, HELIOS_ERROR on failure
    async getStatus() {
        if (this.closed) return HELIOS_ERROR;
        try {
            const buffer = new Uint8Array(2);
            buffer[0] = HELIOS_GET_STATUS_COMMAND;
            buffer[1] = 0;
            let retry = MAX_GET_STATUS_RETRIES;
            while (retry > 0) {
                const result = await this.sendControl(buffer);
                if (result !== HELIOS_ERROR && result.status === 'ok' && result.data &&
                    result.data.getUint8(0) === HELIOS_STATUS_RESPONSE_CODE) {
                    if (result.data.getUint8(1) === 1) {
                        return HELIOS_SUCCESS;
                    }
                }
                retry--;
            }
            return HELIOS_FAIL;
        } catch (error) {
            console.error('Error getting status:', error);
            return HELIOS_ERROR;
        }
    }

    async setShutter(level) {
        if (this.closed) return HELIOS_ERROR;
        try {
            const buffer = new Uint8Array(2);
            buffer[0] = HELIOS_SET_SHUTTER_COMMAND;
            buffer[1] = level;
            const result = await this.sendControl(buffer);
            if (result !== HELIOS_ERROR && result.status === 'ok') {
                return HELIOS_SUCCESS;
            }
            return HELIOS_FAIL;
        } catch (error) {
            console.error('Error setting shutter:', error);
            return HELIOS_ERROR;
        }
    }

    async start() {
        if (this.closed) return HELIOS_ERROR;
        this.#playloop();
    }

    async stop() {
        if (this.closed) return HELIOS_ERROR;
        this.#running = false;
        const buffer = new Uint8Array(2);
        buffer[0] = HELIOS_STOP_COMMAND;
        buffer[1] = 0;
        let retry = 3;
        while (retry > 0) {
            try {
                const result = await this.sendControl(buffer);
                if (result !== HELIOS_ERROR && result.status === 'ok') {
                    await new Promise(resolve => setTimeout(resolve, 100)); //  required settling time per reference SDK
                    return HELIOS_SUCCESS;
                }
            } catch (error) {
                console.error('Error stopping device:', error);
            }
            retry--;
        }
        return HELIOS_ERROR;
    }

    //  For webUSB this needs hardening up. It is a possible attack vector leaving the
    //  Helios DAC without firmware.
    async eraseFirmware() {
        if (this.closed) return HELIOS_ERROR;
        const buffer = new Uint8Array(2);
        buffer[0] = HELIOS_ERASE_FIRMWARE_COMMAND;
        buffer[1] = 0;
        try {
            const result = await this.sendControl(buffer);
            if (result !== HELIOS_ERROR && result.status === 'ok') {
                return HELIOS_SUCCESS;
            }
            return HELIOS_FAIL;
        } catch (error) {
            console.error('Error erasing firmware:', error);
            return HELIOS_ERROR;
        }
    }

    async close() {
        if (this.closed) return;
        try {
            await this.stop();
            await new Promise(resolve => setTimeout(resolve, 100));
            await this.usbDevice.close();
            this.closed = true;
        } catch (error) {
            console.error('Error closing device:', error);
        }
    }

    get pps() {
        return this.#pps;
    }

    set pps(value) {
        this.#pps = Math.min(Math.max(HELIOS_MIN_RATE, value), HELIOS_MAX_RATE);
    }

    get name() {
        return this.#name;
    }

    set name(value) {
        this.#setName(value);
    }

    get firmwareVersion() {
        return this.#firmwareVersion;
    }

    get manufacturerName() {
        return this.usbDevice.manufacturerName;
    }

    get productName() {
        return this.usbDevice.productName;
    }
}
