# Helios DAC JavaScript SDK — API Reference

All exports come from `helios_dac.js`.

```javascript
import { HeliosPoint, connectHeliosDevice, getHeliosDevices, HeliosDevice } from '/lib/helios_dac.js';
```

---

## Return values

Most async methods return one of three integer constants:

| Constant | Value | Meaning |
|----------|-------|---------|
| `HELIOS_SUCCESS` | `1` | Operation completed successfully |
| `HELIOS_FAIL` | `0` | Valid but negative result (e.g. device busy) |
| `HELIOS_ERROR` | `-1` | Unexpected failure (USB error, device closed, etc.) |

---

## `HeliosPoint`

Represents a single point in a laser frame.

```javascript
new HeliosPoint(x, y, r, g, b, i)
```

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `x` | number | 0 – 4095 | Horizontal position (12-bit, left to right) |
| `y` | number | 0 – 4095 | Vertical position (12-bit, bottom to top) |
| `r` | number | 0 – 255 | Red channel |
| `g` | number | 0 – 255 | Green channel |
| `b` | number | 0 – 255 | Blue channel |
| `i` | number | 0 – 255 | Intensity / blanking. **Optional.** Defaults to `255` if any colour channel is non-zero, `0` if all channels are zero. |

**Example — blanking dwell point:**
```javascript
new HeliosPoint(2048, 2048, 0, 0, 0)   // beam off at centre
```

**Example — lit point:**
```javascript
new HeliosPoint(1000, 3000, 255, 128, 0) // orange at (1000, 3000)
```

### Coordinate system

The DAC coordinate space is 12-bit (0 – 4095) on both axes. The physical mapping depends on the projector calibration, but conventionally:
- `x = 0` is far left, `x = 4095` is far right
- `y = 0` is bottom, `y = 4095` is top

### Dwell points

Galvo mirrors need time to settle when jumping between distant points. Add several blanked copies of the start and end points of each line segment to prevent visible overshooting:

```javascript
// 10 blanking dwell points before the line
for (let i = 0; i < 10; i++) frame.push(new HeliosPoint(x0, y0, 0, 0, 0));
// lit line
for (let i = 0; i < 200; i++) frame.push(new HeliosPoint(x0 + i * dx, y0 + i * dy, 255, 0, 0));
// 10 blanking dwell points after
for (let i = 0; i < 10; i++) frame.push(new HeliosPoint(x1, y1, 0, 0, 0));
```

---

## `connectHeliosDevice()`

```javascript
async function connectHeliosDevice(): Promise<HeliosDevice | null>
```

Opens the browser's WebUSB device-picker dialog filtered to Helios DACs. Returns a new `HeliosDevice` wrapping the chosen USB device, or `null` if no device was selected.

**Must be called from a user gesture** (button click, key press, etc.) — browsers block WebUSB permission dialogs triggered programmatically.

This only grants permission and wraps the device. Call `device.connect()` afterwards to open the USB interface and run the init sequence.

```javascript
connectBtn.addEventListener('click', async () => {
    const device = await connectHeliosDevice();
    if (device) {
        await device.connect();
        device.start();
    }
});
```

---

## `getHeliosDevices()`

```javascript
async function getHeliosDevices(): Promise<HeliosDevice[]>
```

Returns an array of `HeliosDevice` objects for every Helios DAC the browser has already been granted permission to access. Requires no user gesture.

Devices returned here are not yet connected — call `device.connect()` on each one before use.

Returns an empty array if no permitted devices are found or if `connectHeliosDevice()` has never been called in this browser profile.

```javascript
const devices = await getHeliosDevices();
for (const device of devices) {
    await device.connect();
    device.start();
}
```

---

## `HeliosDevice`

Controls a single Helios DAC over WebUSB.

Not usually constructed directly — obtain instances from `connectHeliosDevice()` or `getHeliosDevices()`.

### Constructor

```javascript
new HeliosDevice(usbDevice, pps = 30000)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `usbDevice` | `USBDevice` | A raw WebUSB device object |
| `pps` | number | Default points per second used when `sendFrame` is called with `pps = 0`. Clamped to 7 – 65535. |

---

### Lifecycle methods

#### `connect()`

```javascript
async connect(): Promise<void | HELIOS_ERROR>
```

Opens the USB interface, claims it, waits 100 ms for the device to settle, then runs the init sequence (reads firmware version, sends SDK version handshake, reads device name).

Must be called before `start()`, `sendFrame()`, or any other method that communicates with the DAC.

---

#### `start()`

```javascript
async start(): Promise<void | HELIOS_ERROR>
```

Starts the internal play loop. The loop polls `getStatus()` in a tight async loop and calls `onFrame` each time the DAC reports it is ready for a new frame. The loop runs until `stop()` or `close()` is called.

Returns `HELIOS_ERROR` if the device is not connected.

---

#### `stop()`

```javascript
async stop(): Promise<HELIOS_SUCCESS | HELIOS_ERROR>
```

Stops the play loop and sends the STOP command to the DAC. Waits 100 ms after a successful stop (required by the DAC firmware). Retries up to 3 times on failure.

---

#### `close()`

```javascript
async close(): Promise<void>
```

Calls `stop()`, waits 100 ms, then closes the USB connection. Sets `device.closed = true`. Safe to call if already closed.

---

### Frame methods

#### `sendFrame()`

```javascript
async sendFrame(
    points: HeliosPoint[],
    pps?: number,
    singleShot?: boolean,
    interruptFrame?: boolean,
    enabled?: boolean
): Promise<HELIOS_SUCCESS | HELIOS_ERROR>
```

Packs and transmits a single frame to the DAC over the bulk OUT endpoint.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `points` | `HeliosPoint[]` | — | Array of points. Maximum 4095. |
| `pps` | number | `30000` | Points per second. Pass `0` to use the device's default `pps` property. Clamped to 7 – 65535. |
| `singleShot` | boolean | `false` | If `true`, the DAC plays the frame once and stops. If `false`, it loops the frame until the next one arrives. |
| `interruptFrame` | boolean | `false` | If `true`, starts playback immediately rather than waiting for the current frame to finish. |
| `enabled` | boolean | `true` | If `false`, builds the frame buffer but does not transmit it (useful for testing). |

Returns `HELIOS_ERROR` if the device is closed, `points` is null, the point count exceeds 4095, or a frame transfer is already in flight (`frameReady === true`).

> **Note:** A firmware quirk requires point counts where `(count − 45) % 64 === 0` to be reduced by one, with PPS adjusted proportionally. `sendFrame` handles this automatically.

**Typical usage inside `onFrame`:**
```javascript
device.onFrame = (device) => {
    const frame = buildFrame();
    device.sendFrame(frame, 30000);
};
```

---

#### `getStatus()`

```javascript
async getStatus(): Promise<HELIOS_SUCCESS | HELIOS_FAIL | HELIOS_ERROR>
```

Queries the DAC for its readiness to receive a new frame.

| Return | Meaning |
|--------|---------|
| `HELIOS_SUCCESS` (`1`) | DAC is ready for a new frame |
| `HELIOS_FAIL` (`0`) | DAC is still playing the previous frame |
| `HELIOS_ERROR` (`-1`) | USB error or device closed |

The play loop calls this automatically. You only need to call it manually if you are managing the frame loop yourself instead of using `start()`.

---

### Control methods

#### `setShutter(level)`

```javascript
async setShutter(level: number): Promise<HELIOS_SUCCESS | HELIOS_FAIL | HELIOS_ERROR>
```

Opens (`level = 1`) or closes (`level = 0`) the laser shutter. A closed shutter blanks the laser output regardless of the frame data being sent.

---

#### `eraseFirmware()`

```javascript
async eraseFirmware(): Promise<HELIOS_SUCCESS | HELIOS_FAIL | HELIOS_ERROR>
```

Erases the DAC firmware. **Destructive — use with extreme caution.** The device will be non-functional until firmware is re-flashed.

---

### Properties

#### `onFrame`

```javascript
onFrame: ((device: HeliosDevice, lastPoint: HeliosPoint | null) => void) | null
```

Callback invoked by the play loop each time the DAC is ready for a new frame. Set this before calling `start()`.

| Argument | Description |
|----------|-------------|
| `device` | The `HeliosDevice` that is ready |
| `lastPoint` | The last `HeliosPoint` from the previous frame, or `null` on the first call |

```javascript
device.onFrame = (device, lastPoint) => {
    device.sendFrame(buildFrame(), 30000);
};
```

---

#### `name`

```javascript
get name(): string
set name(value: string)
```

The user-assigned name stored in the DAC's flash memory (max 31 characters). Reading returns the name fetched during `connect()`. Writing sends a `SET_NAME` command to the DAC asynchronously.

---

#### `pps`

```javascript
get pps(): number
set pps(value: number)
```

Default points per second. Used by `sendFrame` when called with `pps = 0`. Clamped to 7 – 65535.

---

#### `firmwareVersion`

```javascript
get firmwareVersion(): number
```

32-bit firmware version number read from the DAC during `connect()`. `0` if not yet connected or if the query failed.

---

#### `manufacturerName`

```javascript
get manufacturerName(): string
```

USB manufacturer string from the device descriptor (e.g. `"Bitlasers"`).

---

#### `productName`

```javascript
get productName(): string
```

USB product string from the device descriptor (e.g. `"Helios Laser DAC"`).

---

#### `closed`

```javascript
closed: boolean
```

`true` if the device has not been connected or has been closed. Most methods return `HELIOS_ERROR` immediately when `closed` is `true`.

---

#### `frameReady`

```javascript
frameReady: boolean
```

`true` while a bulk frame transfer is in flight. `sendFrame` returns `HELIOS_ERROR` without sending if this is `true`, preventing overlapping transmissions. Cleared automatically in a `finally` block after each transfer.

---

## Frame rate and timing

The DAC plays points at the rate specified by `pps`. A frame of `N` points takes `N / pps` seconds to play. For smooth animation:

- A 256-point frame at 30,000 pps plays in ~8.5 ms (~117 fps theoretical maximum).
- Leave headroom for USB transfer overhead — 20–40 ms frame durations (50–25 fps) are reliable.
- The play loop calls `onFrame` only when the DAC signals readiness, so you are naturally rate-limited to the DAC's playback speed.

---

## Gradient2D

`gradient2d.js` is a companion utility that uses Three.js WebGL to render a 2D weighted-interpolation colour gradient. Use it to generate dynamic colour maps to sample from in your `onFrame` callback.

```javascript
import { Gradient2D } from '/lib/gradient2d.js';

const gradient = new Gradient2D(256, 256, document.querySelector('#container'));
gradient.addColorStop(0.5, 0.5, 1.5, 1.0, 0.0, 0.5); // x, y, weight, r, g, b
gradient.render();

const pixels = await gradient.getColors(0, 0, 256, 256); // RGBA Uint8Array
```

### `addColorStop(x, y, weight, r, g, b)`

Adds a colour influence point. `x` and `y` are 0–1 normalised positions. `weight` controls the radius of influence. `r`, `g`, `b` are 0–1 normalised colour components, or a CSS colour string can be passed as `r` with `g` and `b` omitted.

### `getColors(x, y, width, height)`

Returns a `Promise<Uint8Array>` containing RGBA pixel data for the given rectangle (pixel coordinates). Use the async form for best performance.

### Other methods

| Method | Description |
|--------|-------------|
| `render()` | Re-renders the gradient to the offscreen buffer |
| `start()` | Starts a `requestAnimationFrame` render loop |
| `stop()` | Stops the render loop |
| `clear()` | Removes all colour stops |
| `deleteColorStop(index)` | Removes the colour stop at the given index |
| `saveImageToFile(fileName)` | Downloads the gradient as a PNG |
| `getColorAsHex(index)` | Returns the colour at `index` as a hex string |
| `setColorAsHex(index, hex)` | Sets the colour at `index` from a hex string |

### Properties

| Property | Description |
|----------|-------------|
| `canvas` | The underlying `HTMLCanvasElement` |
| `colorStopCount` | Number of colour stops currently defined |
| `antialias` | Whether antialiasing was enabled at construction |
