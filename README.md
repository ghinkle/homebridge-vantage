# VantageControls Modern for Homebridge
A TypeScript reimplementation of the VantageControls InFusion plugin for homebridge with updated dependencies and modern Node.js support.

VantageControls (http://www.vantagecontrols.com/) InFusion is a high-end solution that can manage:
- Lighting (standard on/off/dimmed lights and RGB solutions using DMX, DALI or wireless bulbs like Hue or LiFX)
- Thermoregulation (with own or third party thermostats and HVAC systems)
- Curtains, doors (third party)
- A/V systems (own and third party)
- Security systems (third party)
- Weather stations

With this plugin, you can control all systems that are already connected to Vantage without additional 
support from the manufacturer of the connected device. For example, you can control an AC system without the 
HomeKit support of the specific vendor because you are already controlling it via InFusion's Driver that supports up to 18,000 devices.

# Installation
Install the plugin with npm:
```
npm install -g homebridge-vantage-modern
```

Add the platform to the config.json of your homebridge instance:

```json
{
    "platforms": [{
        "platform": "VantageControlsModern",
        "ipaddress": "192.168.1.1",
        "debug": false
    }], 
    "bridge": {
        "username": "CC:22:3D:E3:CE:31", 
        "name": "Vantage HomeBridge Adapter", 
        "pin": "342-52-220", 
        "port": 51826
    }, 
    "description": "My Fantastic Vantage System", 
    "accessories": []
}
```

Restart homebridge and enjoy!

# Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| ipaddress | string | Yes | - | IP address of the Vantage controller |
| username | string | No | - | Username for authentication (if required) |
| password | string | No | - | Password for authentication (if required) |
| omit | string | No | - | Comma-separated list of VIDs to omit |
| range | string | No | - | Range of VIDs to include (format: min,max) |
| usecache | boolean | No | true | Use cached device configuration |
| debug | boolean | No | false | Enable debug logging |

# Supported Devices

Currently, it should be possible to control all loads registered on your InFusion device:
- Dimmers and Relay Loads
- RGB Lights
- Blinds and Shades
- Thermostats

# Troubleshooting

If you encounter issues with the plugin:

1. Enable debug logging by setting `"debug": true` in your config
2. Check the Homebridge logs for detailed information
3. Make sure your Vantage controller is accessible at the specified IP address
4. Verify that port 3001 is open on your Vantage controller

# Disclaimer

This software is provided "as is". No warranty of any kind is provided, whether express, implied, or statutory, including, but not limited to, any warranty of merchantability or fitness for a particular purpose or any warranty that the contents of the item will be error-free.

The development of this module is not supported by Vantage Controls or Apple. These vendors and the developers are not responsible for direct, indirect, incidental, or consequential damages resulting from any defect, error, or failure to perform.  