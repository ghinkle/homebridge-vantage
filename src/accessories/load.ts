import { Service, CharacteristicValue } from 'homebridge';
import { VantageAccessory, VantageAccessoryConfig } from './base';
import { VantagePlatform } from '../platform';

export interface VantageLoadState {
  brightness: number;
  power: boolean;
}

export class VantageLoad extends VantageAccessory {
  private readonly lightbulbService: Service;
  private state: VantageLoadState = {
    brightness: 100,
    power: false,
  };

  constructor(
    platform: VantagePlatform,
    config: VantageAccessoryConfig,
  ) {
    super(platform, config);

    // Determine if this is a fan based on name
    const isFan = config.name.toLowerCase().includes('fan');
    const isDimmer = config.type === 'dimmer';

    // Log the configuration
    // platform.log.debug(`Creating VantageLoad accessory: ${config.name} (VID: ${config.vid})`);
    // platform.log.debug(`  Type: ${config.type}, isFan: ${isFan}, isDimmer: ${isDimmer}`);

    // Create the primary service
    if (isFan) {
      // Create a fan service
      this.lightbulbService = new platform.Service.Fan(config.name);

      // Configure the fan service
      this.lightbulbService
        .getCharacteristic(platform.Characteristic.On)
        .onGet(() => {
          // platform.log.debug(`Getting power for ${config.name}: ${this.state.power}`);
          return this.state.power;
        })
        .onSet(async (value: CharacteristicValue) => {
          this.state.power = value as boolean;
          if (this.state.power && this.state.brightness === 0) {
            this.state.brightness = 100;
          }

          // platform.log.debug(`Setting power for ${config.name} to ${this.state.power ? 'ON' : 'OFF'}`);

          await this.platform.infusion.setLoadLevel(
            this.config.vid,
            this.state.power ? this.state.brightness : 0
          );
        });

      // Add rotation speed characteristic for fans
      this.lightbulbService
        .getCharacteristic(platform.Characteristic.RotationSpeed)
        .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
        .onGet(() => {
          // platform.log.debug(`Getting rotation speed for ${config.name}: ${this.state.brightness}`);
          return this.state.brightness;
        })
        .onSet(async (value: CharacteristicValue) => {
          this.state.brightness = value as number;
          this.state.power = this.state.brightness > 0;

          // platform.log.debug(`Setting rotation speed for ${config.name} to ${this.state.brightness}`);

          await this.platform.infusion.setLoadLevel(
            this.config.vid,
            this.state.brightness
          );
        });
    } else {
      // Create a lightbulb service
      this.lightbulbService = new platform.Service.Lightbulb(config.name);

      // Configure the lightbulb service
      this.lightbulbService
        .getCharacteristic(platform.Characteristic.On)
        .onGet(() => {
          // platform.log.debug(`Getting power for ${config.name}: ${this.state.power}`);
          return this.state.power;
        })
        .onSet(async (value: CharacteristicValue) => {
          this.state.power = value as boolean;
          if (this.state.power && this.state.brightness === 0) {
            this.state.brightness = 100;
          }

          // platform.log.debug(`Setting power for ${config.name} to ${this.state.power ? 'ON' : 'OFF'}`);

          await this.platform.infusion.setLoadLevel(
            this.config.vid,
            this.state.power ? this.state.brightness : 0
          );
        });

      // Add brightness characteristic for dimmable lights
      if (isDimmer) {
        // platform.log.debug(`  Adding brightness control for ${config.name}`);

        // Add the brightness characteristic
        this.lightbulbService
          .addCharacteristic(platform.Characteristic.Brightness)
          .setProps({
            minValue: 0,
            maxValue: 100,
            minStep: 1
          })
          .onGet(() => {
            // platform.log.debug(`Getting brightness for ${config.name}: ${this.state.brightness}`);
            return this.state.brightness;
          })
          .onSet(async (value: CharacteristicValue) => {
            this.state.brightness = value as number;
            this.state.power = this.state.brightness > 0;

            // platform.log.debug(`Setting brightness for ${config.name} to ${this.state.brightness}`);

            await this.platform.infusion.setLoadLevel(
              this.config.vid,
              this.state.brightness
            );
          });
      }
    }

    // Add the service to our services array
    this.services.push(this.lightbulbService);

    // Log all services and characteristics for debugging
    // platform.log.debug(`Services for ${config.name}:`);
    this.services.forEach(service => {
      // platform.log.debug(`  Service: ${service.displayName || service.constructor.name}`);
      service.characteristics.forEach(characteristic => {
        // platform.log.debug(`    Characteristic: ${characteristic.constructor.name}`);
      });
    });

    // Get initial state
    this.platform.infusion.getLoadStatus(this.config.vid);
  }

  getModel(): string {
    if (this.config.name.toLowerCase().includes('fan')) {
      return 'Fan';
    }
    return this.config.type === 'dimmer' ? 'Dimmable Light' : 'Light';
  }

  updateState(brightness: number): void {
    this.state.brightness = brightness;
    this.state.power = brightness > 0;

    // this.platform.log.debug(`Updating state for ${this.config.name}: brightness=${brightness}, power=${this.state.power}`);

    // Update the On characteristic
    this.lightbulbService
      .getCharacteristic(this.platform.Characteristic.On)
      .updateValue(this.state.power);

    // Determine if this is a fan based on name
    const isFan = this.config.name.toLowerCase().includes('fan');
    const isDimmer = this.config.type === 'dimmer';

    // Update the brightness/rotation speed characteristic if it exists
    if (isFan) {
      if (this.lightbulbService.testCharacteristic(this.platform.Characteristic.RotationSpeed)) {
        // this.platform.log.debug(`Updating rotation speed for ${this.config.name} to ${this.state.brightness}`);
        this.lightbulbService
          .getCharacteristic(this.platform.Characteristic.RotationSpeed)
          .updateValue(this.state.brightness);
      }
    } else if (isDimmer) {
      if (this.lightbulbService.testCharacteristic(this.platform.Characteristic.Brightness)) {
        // this.platform.log.debug(`Updating brightness for ${this.config.name} to ${this.state.brightness}`);
        this.lightbulbService
          .getCharacteristic(this.platform.Characteristic.Brightness)
          .updateValue(this.state.brightness);
      }
    }
  }
}
