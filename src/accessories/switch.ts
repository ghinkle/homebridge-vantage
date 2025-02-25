import { Service, CharacteristicValue } from 'homebridge';
import { VantageAccessory, VantageAccessoryConfig } from './base';
import { VantagePlatform } from '../platform';

export interface VantageSwitchState {
  power: boolean;
}

export class VantageSwitch extends VantageAccessory {
  private readonly switchService: Service;
  private state: VantageSwitchState = {
    power: false,
  };

  constructor(
    platform: VantagePlatform,
    config: VantageAccessoryConfig,
  ) {
    super(platform, config);

    this.switchService = new platform.Service.Switch(config.name);

    this.switchService
      .getCharacteristic(platform.Characteristic.On)
      .onGet(() => this.state.power)
      .onSet(async (value: CharacteristicValue) => {
        this.state.power = value as boolean;
        await this.platform.infusion.setLoadLevel(
          this.config.vid,
          this.state.power ? 100 : 0
        );
      });

    this.services.push(this.switchService);

    // Get initial state
    this.platform.infusion.getLoadStatus(this.config.vid);
  }

  getModel(): string {
    return 'Switch';
  }

  updateState(isOn: boolean): void {
    this.state.power = isOn;
    
    this.switchService
      .getCharacteristic(this.platform.Characteristic.On)
      .updateValue(this.state.power);
  }
} 