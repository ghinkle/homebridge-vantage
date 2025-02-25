import { PlatformConfig } from 'homebridge';

export interface VantagePlatformConfig extends PlatformConfig {
  ipaddress: string;
  username?: string;
  password?: string;
  omit?: string;
  range?: string;
  usecache?: boolean;
  debug?: boolean;
}

export class ConfigValidator {
  static validate(config: PlatformConfig): VantagePlatformConfig {
    if (!config.ipaddress) {
      throw new Error('Configuration error: ipaddress is required');
    }

    // Validate IP address format
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(config.ipaddress)) {
      throw new Error('Configuration error: invalid IP address format');
    }

    // Validate credentials consistency
    if ((config.username && !config.password) || (!config.username && config.password)) {
      throw new Error('Configuration error: both username and password must be provided if using authentication');
    }

    // Validate omit list format
    if (config.omit) {
      const omitList = config.omit.split(',').map(x => x.trim());
      if (!omitList.every(x => /^\d+$/.test(x))) {
        throw new Error('Configuration error: omit list must contain only numbers separated by commas');
      }
    }

    // Validate range format
    if (config.range) {
      const range = config.range.split(',').map(x => parseInt(x.trim()));
      if (range.length !== 2 || isNaN(range[0]) || isNaN(range[1]) || range[0] >= range[1]) {
        throw new Error('Configuration error: range must be two numbers separated by a comma, with first number less than second');
      }
    }

    return {
      ...config,
      ipaddress: config.ipaddress,
      usecache: config.usecache ?? true,
      debug: config.debug ?? false,
    };
  }

  static getConfigExample(): string {
    return JSON.stringify({
      "platform": "VantageControls",
      "ipaddress": "192.168.1.100",
      "username": "admin",
      "password": "password",
      "omit": "1,2,3",
      "range": "1,100",
      "usecache": true,
      "debug": false
    }, null, 2);
  }
} 