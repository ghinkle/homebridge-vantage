import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { VantageInfusion } from './vantageInfusion';
import { VantageAccessory } from './accessories/base';
import { VantageThermostat } from './accessories/thermostat';
import { VantageLoad } from './accessories/load';
import { VantageBlind } from './accessories/blind';
import { VantageSwitch } from './accessories/switch';
import { ConfigValidator, VantagePlatformConfig } from './config';

export const PLATFORM_NAME = 'VantageControlsModern';
export const PLUGIN_NAME = 'homebridge-vantage-modern';

export class VantagePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  public readonly infusion: VantageInfusion;
  private readonly deviceMap = new Map<string, VantageAccessory>();
  private readonly validatedConfig: VantagePlatformConfig;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    try {
      this.validatedConfig = ConfigValidator.validate(config);
    } catch (error) {
      this.log.error('Configuration error:', (error as Error).message);
      this.log.info('Example configuration:', ConfigValidator.getConfigExample());
      throw error;
    }

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    // Log plugin initialization
    this.log.info('VantageControlsModern platform initialized');
    this.log.debug('Debug logging is ' + (this.validatedConfig.debug ? 'enabled' : 'disabled'));

    this.infusion = new VantageInfusion({
      ipAddress: this.validatedConfig.ipaddress,
      username: this.validatedConfig.username || '',
      password: this.validatedConfig.password || '',
      omit: this.validatedConfig.omit || '',
      range: this.validatedConfig.range || '',
      log: this.validatedConfig.debug ? this.log : this.createSilentLogger(),
      debug: this.validatedConfig.debug,
    });

    this.setupEventHandlers();

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.startDiscovery();
    });
  }

  private createSilentLogger(): Logger {
    return {
      info: (message: string, ...params: any[]) => {
        // Always log important info messages
        if (message.includes('Discovered') ||
            message.includes('Connected') ||
            message.includes('Disconnected')) {
          this.log.info(message, ...params);
        }
      },
      warn: (message: string, ...params: any[]) => this.log.warn(message, ...params),
      error: (message: string, ...params: any[]) => this.log.error(message, ...params),
      debug: () => {},
      log: () => {},
      success: (message: string, ...params: any[]) => {
        // Log success messages for important events
        if (message.includes('Discovered') ||
            message.includes('Connected')) {
          this.log.info(message, ...params);
        }
      },
    };
  }

  private setupEventHandlers(): void {
    // Handle load status changes
    this.infusion.on('loadStatusChange', (vid: string, value: number) => {
      const accessory = this.deviceMap.get(vid.toString());
      if (accessory instanceof VantageLoad) {
        accessory.updateState(value);
      } else if (accessory instanceof VantageSwitch) {
        accessory.updateState(value > 0);
      }
    });

    // Handle blind status changes
    this.infusion.on('blindStatusChange', (vid: string, position: number) => {
      const accessory = this.deviceMap.get(vid.toString());
      if (accessory instanceof VantageBlind) {
        accessory.updatePosition(position);
      }
    });

    // Handle thermostat changes
    this.infusion.on('thermostatIndoorTemperatureChange', (vid: string, temp: number) => {
      const accessory = this.deviceMap.get(vid.toString());
      if (accessory instanceof VantageThermostat) {
        accessory.updateTemperature(temp);
      }
    });

    this.infusion.on('thermostatIndoorModeChange', (vid: string, mode: number) => {
      const accessory = this.deviceMap.get(vid.toString());
      if (accessory instanceof VantageThermostat) {
        accessory.updateMode(mode);
      }
    });
  }

  private async startDiscovery(): Promise<void> {
    try {
      this.infusion.on('discoveryComplete', (devices) => {
        // Array to store new accessories that need to be registered
        const newAccessories: PlatformAccessory[] = [];

        for (const device of devices) {
          // Get the VID as a string
          const vidStr = device.VID;

          // Skip devices in omit list or outside range
          if (this.shouldSkipDevice(vidStr)) continue;

          // Generate a unique id for this device
          const uuid = this.api.hap.uuid.generate(vidStr);

          // Check if an accessory with the same uuid has already been registered and restored from
          // the cached devices we stored in the `configureAccessory` method
          const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

          if (existingAccessory) {
            // The accessory already exists
            // this.log.info(`Restoring existing accessory: ${device.Name} (VID: ${vidStr})`);

            // Update the accessory context
            existingAccessory.context.device = device;

            // Create the accessory handler
            this.setupAccessoryHandler(existingAccessory, device);

            // Update accessory cache
            this.api.updatePlatformAccessories([existingAccessory]);
          } else {
            // The accessory does not yet exist, so we need to create it
            this.log.info(`Adding new accessory: ${device.Name} (VID: ${vidStr})`);

            // Create a new accessory
            const accessory = new this.api.platformAccessory(device.Name, uuid);

            // Store a copy of the device object in the `accessory.context`
            accessory.context.device = device;

            // Set the room for this accessory if area information is available
            if (device.Area) {
              accessory.context.roomName = device.Area.toString();
            }

            // Create the accessory handler
            this.setupAccessoryHandler(accessory, device);

            // Add to the list of new accessories
            newAccessories.push(accessory);
          }
        }

        // Register new accessories with Homebridge
        if (newAccessories.length > 0) {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories);
          this.accessories.push(...newAccessories);
        }

        this.log.info(`Discovered ${devices.length} devices, registered ${newAccessories.length} new accessories`);
      });

      await this.infusion.discover();
    } catch (error) {
      this.log.error('Discovery failed:', error);
    }
  }

  private setupAccessoryHandler(accessory: PlatformAccessory, device: any): void {
    const config = {
      name: this.getDeviceName(device),
      vid: device.VID,
      type: this.getDeviceType(device),
    };

    // Log the device type and config for debugging
    // this.log.debug(`Setting up accessory for ${device.Name} (VID: ${device.VID})`);
    // this.log.debug(`  ObjectType: ${device.ObjectType}`);
    // this.log.debug(`  LoadType: ${device.LoadType || 'undefined'}`);
    // this.log.debug(`  Config type: ${config.type}`);

    // Set the room for this accessory if area information is available
    if (device.Area) {
      const roomName = device.Area.toString();
      // this.log.debug(`  Setting room to: ${roomName}`);
      accessory.context.roomName = roomName;
    }

    let handler: VantageAccessory;

    switch (device.ObjectType) {
      case 'Thermostat':
        handler = new VantageThermostat(this, config);
        // this.log.debug(`  Created Thermostat accessory`);
        break;
      case 'Blind':
      case 'RelayBlind':
      case 'QubeBlind':
        handler = new VantageBlind(this, config);
        // this.log.debug(`  Created Blind accessory`);
        break;
      case 'Load':
        if (this.isRelay(device)) {
          handler = new VantageSwitch(this, config);
          // this.log.debug(`  Created Switch accessory (relay)`);
        } else {
          handler = new VantageLoad(this, config);
          // this.log.debug(`  Created Load accessory (${config.type})`);
        }
        break;
      default:
        this.log.warn(`Unknown device type: ${device.ObjectType}`);
        return;
    }

    // Store the handler in our map
    this.deviceMap.set(device.VID, handler);

    // Get all services from the handler
    const services = handler.getServices();

    // Remove any existing services
    accessory.services.forEach(service => {
      if (service.UUID !== this.api.hap.Service.AccessoryInformation.UUID) {
        accessory.removeService(service);
      }
    });

    // Add all services from the handler
    services.forEach(service => {
      if (service.UUID !== this.api.hap.Service.AccessoryInformation.UUID) {
        accessory.addService(service);
      } else {
        // Update the AccessoryInformation service
        const infoService = accessory.getService(this.api.hap.Service.AccessoryInformation);
        if (infoService) {
          // Set the basic information
          infoService
            .setCharacteristic(this.Characteristic.Name, config.name)
            .setCharacteristic(this.Characteristic.Manufacturer, 'Vantage Controls')
            .setCharacteristic(this.Characteristic.Model, handler.getModel())
            .setCharacteristic(this.Characteristic.SerialNumber, `VID ${config.vid}`);
        }
      }
    });
  }

  private shouldSkipDevice(vid: string | number): boolean {
    // Convert to string for comparison
    const vidStr = vid.toString();

    // Check if it's in the omit list
    const omitList = (this.validatedConfig.omit || '').split(',').map(x => x.trim());
    if (omitList.includes(vidStr)) {
      this.log.debug(`Skipping device ${vidStr} (in omit list)`);
      return true;
    }

    // Check if it's outside the range (only for numeric VIDs)
    const numVid = typeof vid === 'number' ? vid : parseInt(vidStr);
    if (!isNaN(numVid)) {
      const range = (this.validatedConfig.range || '').split(',').map(x => parseInt(x.trim()));
      if (range.length === 2) {
        if (numVid < range[0] || numVid > range[1]) {
          // this.log.debug(`Skipping device ${vidStr} (outside range ${range[0]}-${range[1]})`);
          return true;
        }
      }
    }

    return false;
  }

  private getDeviceName(device: any): string {
    let name = device.DName || device.Name || '';

    // Add area name as prefix if available
    if (device.Area) {
      // Make sure we're using a string
      const areaName = device.Area.toString();

      // Only add the area name if it's not already part of the name
      if (!name.includes(areaName)) {
        name = `${areaName} ${name}`;
        // this.log.debug(`Added area name to device: ${name}`);
      }
    }

    return name.replace('-', '').trim() || `Device ${device.VID}`;
  }

  private getDeviceType(device: any): string {
    if (device.ObjectType === 'Thermostat') return 'thermostat';
    if (device.ObjectType.includes('Blind')) return 'blind';
    if (this.isRelay(device)) return 'relay';

    // For Load objects, check if they're dimmable
    if (device.ObjectType === 'Load') {
      return this.isDimmable(device) ? 'dimmer' : 'non-dimmer';
    }

    // Default to non-dimmer for unknown types
    return 'non-dimmer';
  }

  private isRelay(device: any): boolean {
    return device.LoadType?.includes('Relay') || false;
  }

  private isDimmable(device: any): boolean {
    // If it's not a Load type, it's not dimmable
    if (device.ObjectType !== 'Load') {
      // this.log.debug(`Device ${device.VID} (${device.Name}) is not dimmable: Not a Load type (${device.ObjectType})`);
      return false;
    }

    // Check if it's a relay
    if (device.LoadType?.includes('Relay')) {
      // this.log.debug(`Device ${device.VID} (${device.Name}) is not dimmable: Is a relay`);
      return false;
    }

    // In the original implementation, these specific types were considered non-dimmable
    const nonDimmableTypes = [
      'Fluor. Mag non-Dim',
      'LED non-Dim',
      'Fluor. Electronic non-Dim',
      'Low Voltage Relay',
      'High Voltage Relay',
      'Motor'
    ];

    // Check if the LoadType is in the non-dimmable list
    const isNonDimmable = nonDimmableTypes.includes(device.LoadType);

    // this.log.debug(`Device ${device.VID} (${device.Name}) LoadType: "${device.LoadType || 'undefined'}", DeviceCategory: "${device.DeviceCategory || 'undefined'}"`);
    // this.log.debug(`Device ${device.VID} (${device.Name}) is ${!isNonDimmable ? 'dimmable' : 'not dimmable'}`);

    // Return the opposite of isNonDimmable
    return !isNonDimmable;
  }

  // This function is invoked when homebridge restores cached accessories from disk at startup.
  // It should be used to setup event handlers for characteristics and update respective values.
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Loading accessory from cache: ${accessory.displayName}`);

    // Add the restored accessory to the accessories array so we can track it
    this.accessories.push(accessory);
  }

  private getLogger(): Logger {
    return {
      info: (message: string, ...params: any[]) => {
        this.log.info(message, ...params);
      },
      warn: (message: string, ...params: any[]) => {
        this.log.warn(message, ...params);
      },
      error: (message: string, ...params: any[]) => {
        this.log.error(message, ...params);
      },
      debug: () => {},
      log: () => {},
      success: (message: string, ...params: any[]) => {
        this.log.info(message, ...params);
      },
    };
  }
}
