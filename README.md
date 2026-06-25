# helios_dac.js

A WebUSB implementation of the Helios Laser DAC SDK for the browser.

The [Helios Laser DAC](https://bitlasers.com/helios-laser-dac/) is an open-source USB DAC that connects to any show laser via the standard ILDA interface. This library lets you drive it directly from the browser using the WebUSB API — no native drivers or middleware required beyond the initial WinUSB setup described below.

> **Live demo:** [https://dinther.github.io/helios_dac-for-browser/](https://dinther.github.io/helios_dac-for-browser/)

![image](https://github.com/user-attachments/assets/54e4564c-f133-4fc2-a1df-98a825b34db1)

---

## Quick start

```javascript
import { HeliosPoint, connectHeliosDevice } from '/dist/helios_dac.js';

// Must be called from a user gesture (e.g. button click)
const device = await connectHeliosDevice();

device.onFrame = (device) => {
    const frame = [];
    const y = Math.floor(Date.now() % 2000 / 2000 * 4095);
    for (let i = 0; i < 15; i++)
        frame.push(new HeliosPoint(0, y, 0, 0, 0));           // blanking dwell
    for (let i = 0; i < 256; i++)
        frame.push(new HeliosPoint(i * 16, y, 255 - i, i, 0)); // coloured line
    device.sendFrame(frame, 30000);
};

await device.connect();
device.start();
```

---

## Multiple devices

`getHeliosDevices()` returns all Helios DACs the browser has already been granted permission to access. Call `connectHeliosDevice()` at least once first so the user can grant permission.

```javascript
import { HeliosPoint, connectHeliosDevice, getHeliosDevices } from '/dist/helios_dac.js';

async function connect() {
    await connectHeliosDevice(); // prompts the user to grant permission
    const devices = await getHeliosDevices();

    for (const device of devices) {
        device.onFrame = (device) => {
            const frame = [];
            const y = Math.floor(Date.now() % 2000 / 2000 * 4095);
            for (let i = 0; i < 15; i++)
                frame.push(new HeliosPoint(0, y, 0, 0, 0));
            for (let i = 0; i < 256; i++)
                frame.push(new HeliosPoint(i * 16, y, 255 - i, i, 0));
            device.sendFrame(frame, 30000);
        };
        await device.connect();
        device.start();
    }
}
```

To keep multiple lasers frame-perfectly in sync, build the frame once and send it to all devices from a single `onFrame` callback:

```javascript
const leader = devices[0];
leader.onFrame = (device) => {
    const frame = buildFrame();          // compute once
    for (const d of devices)
        d.sendFrame(frame, 30000);       // broadcast to all
};
leader.start();
```

---

## Browser requirements

WebUSB is supported in Chromium-based browsers (Chrome, Edge, Opera). It is not available in Firefox or Safari.

The page must be served over HTTPS (or `localhost`) for WebUSB to be available.

---

## Windows driver setup

WebUSB requires the **WinUSB** driver. The Helios DAC sometimes ships with **libUSB** installed instead, which will prevent the browser from accessing it.

Use [Zadig](https://zadig.akeo.ie/) to check and switch drivers:

1. Plug in all your Helios DACs and make sure no other software (e.g. Beyond, QS) is connected to them.
2. Open Zadig, go to **Options → List All Devices**.
3. Select **Helios Laser DAC** from the dropdown.
4. If the left side of the arrow already shows **WinUSB** you are done.
5. Otherwise, select **WinUSB** on the right side of the arrow, click the dropdown arrow on the install button, choose **Install Driver**, and click it. This takes a few minutes.
6. Repeat for every Helios DAC.

![image](https://github.com/user-attachments/assets/33503be4-0681-455f-b423-010080ccb1b2)

If the browser still cannot access a port after switching drivers, open **regedit**, navigate to `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\USB`, right-click **USB**, select **Permissions**, and grant the most permissive access available.

---

## API reference

See [API.md](API.md) for full documentation of all exported classes and functions.

---

## Acknowledgements

Based on the [Helios DAC SDK](https://github.com/Grix/helios_dac) by Gitle Mikkelsen.
