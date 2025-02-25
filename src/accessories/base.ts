import {Service} from 'homebridge';
import {VantagePlatform} from '../platform';

export interface VantageAccessoryConfig {
  name: string;
  vid: string;
  type: string;
}

export abstract class VantageAccessory {
  protected readonly services: Service[] = [];
  protected readonly informationService: Service;

  constructor(
    protected readonly platform: VantagePlatform,
    protected readonly config: VantageAccessoryConfig,
  ) {
    this.informationService = new platform.Service.AccessoryInformation()
      .setCharacteristic(platform.Characteristic.Name, config.name)
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Vantage Controls')
      .setCharacteristic(platform.Characteristic.Model, this.getModel())
      .setCharacteristic(platform.Characteristic.SerialNumber, `VID ${config.vid}`);

    this.services.push(this.informationService);
  }

  abstract getModel(): string;

  getServices(): Service[] {
    return this.services;
  }
}
