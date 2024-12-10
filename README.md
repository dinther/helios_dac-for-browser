# helios_dac.js
Implementation of the Helios Laser DAC sdk using webUSB.
The Helios Laser DAC from [Bitlasers](https://bitlasers.com/helios-laser-dac/) is a pretty capable open source DAC. It connects to any show laser via the standard ILDA interface and is controlled via USB.
This means that my Beatline show laser software can drive the laser directly from the browser.

Index.html contains a demo on how to connect to the Helios Laser DAC and a suggestion on how to generate dynamic content in real time.

![image](https://github.com/user-attachments/assets/54e4564c-f133-4fc2-a1df-98a825b34db1)


usage:
```javascript
let heliosDevice = await connectHeliosDevice();
heliosDevice.onFrame = (device)=>{
    let frame = [];
    let y = Math.floor(Date.now()%2000 / 2000 * 4095);
    for(let i=0; i<15; i++) frame.push(new HELIOS.HeliosPoint(0, y, 0, 0, 0));          //  Blanking points
    for(let i=0; i<256; i++) frame.push(new HELIOS.HeliosPoint(i*16, y, 255-i, i, 0));  //  Line
    device.sendFrame(frame, 30000);
};
heliosDevice.connect();
heliosDevice.play();
```

![image](https://github.com/user-attachments/assets/0b238368-ff38-4e4f-81e3-a992daecb223)

If you have multiple Helios Laser DAC's then you can also ask for a list of devices that have been given permission to connect.
```javascript
function connect(){
    heliosDevices = await getHeliosDevices();
    heliosDevices.forEach( async (device, index)=>{
        device.onFrame = (device)=>{
            let frame = [];
            let y = Math.floor(Date.now()%2000 / 2000 * 4095);
            for(let i=0; i<15; i++) frame.push(new HELIOS.HeliosPoint(0, y, 0, 0, 0));          //  Blanking points
            for(let i=0; i<256; i++) frame.push(new HELIOS.HeliosPoint(i*16, y, 255-i, i, 0));  //  Line
            device.sendFrame(frame, 30000);
        }
        device.connect();
    });
}
```

Send the same point buffer to all lasers if If you want all lasers to run perfectly in sync
```javascript
            ...
            heliosDevices.forEach( async (device, index)=>{
                device.sendFrame(frame, 30000);
            });
            ...
```

It is possible some ports don't work. This is due to webUSB respecting permission settings in the registry.
Run regedit and fo to the folder shown below.
Computer\HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\USB
Right click on USB and select permissions. Set permissions as permissable as you can.

It is important that Helios Laser DAC uses the winUSB drivers and not the lubUSB drivers.
You can check this with a free program called [Zadig 2.9](https://zadig.akeo.ie/)
Make sure all your Helios Laser DAC's are is plugged in and no software is connected to the DAC.

- Select options - and select List all devices
- In the dropdown select the Helios Laser DAC
- It is says WinUSB on the left of the arrow then we are all good.
- If that is not the case select WinUSB
- Click on the dropdown arrow of the button below and select
- "install driver" and click the button. This takes a few minutes.

**Do this for every Helios Laser DAC**

![image](https://github.com/user-attachments/assets/33503be4-0681-455f-b423-010080ccb1b2)

 
## Live demo
[https://dinther.github.io/helios_dac-for-browser/](https://dinther.github.io/helios_dac-for-browser/)


