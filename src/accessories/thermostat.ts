import { Service, CharacteristicValue } from 'homebridge';
import { VantageAccessory, VantageAccessoryConfig } from './base';
import { VantagePlatform } from '../platform';

export interface VantageThermostatState {
  currentTemperature: number;
  targetTemperature: number;
  currentHeatingCoolingState: number;
  targetHeatingCoolingState: number;
  heatingThreshold: number;
  coolingThreshold: number;
  temperatureDisplayUnits: number;
}

export class VantageThermostat extends VantageAccessory {
  private readonly thermostatService: Service;
  private state: VantageThermostatState = {
    currentTemperature: 0,
    targetTemperature: 0,
    currentHeatingCoolingState: 0,
    targetHeatingCoolingState: 0,
    heatingThreshold: 0,
    coolingThreshold: 0,
    temperatureDisplayUnits: 1,
  };

  constructor(
    platform: VantagePlatform,
    config: VantageAccessoryConfig,
  ) {
    super(platform, config);

    this.thermostatService = new platform.Service.Thermostat(config.name);

    // Current temperature
    this.thermostatService
      .getCharacteristic(platform.Characteristic.CurrentTemperature)
      .onGet(() => this.state.currentTemperature);

    // Current heating/cooling state
    this.thermostatService
      .getCharacteristic(platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.state.currentHeatingCoolingState);

    // Target heating/cooling state
    this.thermostatService
      .getCharacteristic(platform.Characteristic.TargetHeatingCoolingState)
      .onGet(() => this.state.targetHeatingCoolingState)
      .onSet(async (value: CharacteristicValue) => {
        this.state.targetHeatingCoolingState = value as number;
        await this.platform.infusion.setThermostatMode(
          this.config.vid,
          this.state.targetHeatingCoolingState
        );
      });

    // Target temperature
    this.thermostatService
      .getCharacteristic(platform.Characteristic.TargetTemperature)
      .onGet(() => this.state.targetTemperature)
      .onSet(async (value: CharacteristicValue) => {
        this.state.targetTemperature = value as number;
        await this.platform.infusion.setThermostatTemperature(
          this.config.vid,
          this.state.targetTemperature,
          this.state.targetHeatingCoolingState,
          this.state.heatingThreshold,
          this.state.coolingThreshold
        );
      });

    // Temperature display units
    this.thermostatService
      .getCharacteristic(platform.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.state.temperatureDisplayUnits)
      .onSet((value: CharacteristicValue) => {
        this.state.temperatureDisplayUnits = value as number;
      });

    this.services.push(this.thermostatService);

    // Get initial state
    this.platform.infusion.getThermostatState(this.config.vid);
  }

  getModel(): string {
    return 'Thermostat';
  }

  updateTemperature(temperature: number): void {
    this.state.currentTemperature = temperature;
    
    this.thermostatService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .updateValue(this.state.currentTemperature);
  }

  updateMode(mode: number): void {
    this.state.currentHeatingCoolingState = mode;
    this.state.targetHeatingCoolingState = mode;
    
    this.thermostatService
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .updateValue(this.state.currentHeatingCoolingState);
      
    this.thermostatService
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .updateValue(this.state.targetHeatingCoolingState);
  }
} 