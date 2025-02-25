import { Service, CharacteristicValue } from 'homebridge';
import { VantageAccessory, VantageAccessoryConfig } from './base';
import { VantagePlatform } from '../platform';

export interface VantageBlindState {
  currentPosition: number;
  targetPosition: number;
  positionState: number; // 0=decreasing, 1=increasing, 2=stopped
}

export class VantageBlind extends VantageAccessory {
  private readonly blindService: Service;
  private state: VantageBlindState = {
    currentPosition: 100,
    targetPosition: 100,
    positionState: 2,
  };

  constructor(
    platform: VantagePlatform,
    config: VantageAccessoryConfig,
  ) {
    super(platform, config);

    this.blindService = new platform.Service.WindowCovering(config.name);

    // Current Position
    this.blindService
      .getCharacteristic(platform.Characteristic.CurrentPosition)
      .onGet(() => this.state.currentPosition);

    // Target Position
    this.blindService
      .getCharacteristic(platform.Characteristic.TargetPosition)
      .onGet(() => this.state.targetPosition)
      .onSet(async (value: CharacteristicValue) => {
        const newPosition = value as number;
        this.state.targetPosition = newPosition;
        
        // Update position state based on movement direction
        if (newPosition > this.state.currentPosition) {
          this.state.positionState = 1; // increasing
        } else if (newPosition < this.state.currentPosition) {
          this.state.positionState = 0; // decreasing
        }
        
        await this.platform.infusion.setBlindPosition(this.config.vid, newPosition);
      });

    // Position State (moving up/down/stopped)
    this.blindService
      .getCharacteristic(platform.Characteristic.PositionState)
      .onGet(() => this.state.positionState);

    this.services.push(this.blindService);

    // Get initial state
    this.platform.infusion.getBlindPosition(this.config.vid);
  }

  getModel(): string {
    return 'Blind';
  }

  updatePosition(position: number): void {
    this.state.currentPosition = position;
    this.state.targetPosition = position;
    this.state.positionState = this.platform.Characteristic.PositionState.STOPPED;

    this.blindService
      .getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .updateValue(this.state.currentPosition);

    this.blindService
      .getCharacteristic(this.platform.Characteristic.TargetPosition)
      .updateValue(this.state.targetPosition);

    this.blindService
      .getCharacteristic(this.platform.Characteristic.PositionState)
      .updateValue(this.state.positionState);
  }
} 