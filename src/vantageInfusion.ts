import {Logger} from 'homebridge';
import {Socket} from 'net';
import {EventEmitter} from 'events';
import {XMLParser} from 'fast-xml-parser';
import {sprintf} from 'sprintf-js';

interface VantageInfusionConfig {
  ipAddress: string;
  username: string;
  password: string;
  omit: string;
  range: string;
  log: Logger;
  debug: boolean;
}

interface VantageCommand {
  type: string;
  vid: number;
  value: number | string;
}

interface VantageDevice {
  VID: string;
  Name: string;
  Area?: string;
  ObjectType: string;
  LoadType?: string;
  DeviceCategory?: string;
  DName?: string;
}

interface VantageArea {
  VID: string;
  Name: string;
}

export class VantageInfusion extends EventEmitter {
  private readonly commandSocket: Socket;
  private readonly interfaces: Record<string, number> = {};

  constructor(private readonly config: VantageInfusionConfig) {
    super();

    // Set default values
    this.config.debug = this.config.log['level'] === 'debug';

    this.commandSocket = this.setupCommandSocket();
  }

  private setupCommandSocket(): Socket {
    const socket = new Socket();

    this.config.log.info(`Attempting to connect to Vantage controller at ${this.config.ipAddress}:3001`);

    socket.connect(3001, this.config.ipAddress, () => {
      this.config.log.info('Connected to Vantage controller');

      if (this.config.username && this.config.password) {
        this.config.log.debug('Authenticating with username and password');
        socket.write(`LOGIN ${this.config.username} ${this.config.password}\r\n`);
      }

      // Register for status updates
      socket.write('STATUSON\r\n');
    });

    socket.on('data', (data) => this.handleCommandData(data));
    socket.on('error', (error) => this.handleSocketError(error));
    socket.on('close', () => {
      this.config.log.warn('Disconnected from Vantage controller');
      this.setupReconnection();
    });

    return socket;
  }

  private handleCommandData(data: Buffer): void {
    const lines = data.toString().split('\n');

    for (const line of lines) {
      const parts = line.split(' ');
      if (!parts.length) {
        continue;
      }

      this.processCommandResponse(parts);
    }
  }

  private processCommandResponse(parts: string[]): void {
    const [command, ...args] = parts;

    switch (command) {
      case 'S:BLIND':
      case 'R:GETBLIND': {
        const vid = args[0];
        const position = parseInt(args[1]);
        this.emit('blindStatusChange', vid, position);
        break;
      }
      case 'S:LOAD':
      case 'R:GETLOAD':
        this.emit('loadStatusChange', args[0], parseInt(args[1]));
        break;
      case 'S:TEMP':
        this.emit('thermostatDidChange', args[1]);
        break;
      case 'R:INVOKE':
        if (args[2]?.includes('Thermostat.GetIndoorTemperature')) {
          this.emit('thermostatIndoorTemperatureChange',
            args[0],
            parseFloat(args[1])
          );
        }
        break;
      case 'S:THERMOP':
      case 'R:GETTHERMOP':
      case 'R:THERMTEMP': {
        let modeVal = 0;
        if (args[1].includes('OFF')) modeVal = 0;
        else if (args[1].includes('HEAT')) modeVal = 1;
        else if (args[1].includes('COOL')) modeVal = 2;
        else modeVal = 3;

        this.emit('thermostatIndoorModeChange',
          args[0],
          modeVal,
          command === 'R:THERMTEMP' ? parseFloat(args[2]) : -1
        );
        break;
      }
    }
  }

  private handleSocketError(error: Error): void {
    this.config.log.error('Socket error:', error.message);
    this.config.log.debug('Socket error details:', JSON.stringify(error));
    // Socket will emit 'close' after error, triggering reconnection
  }

  public async discover(): Promise<void> {
    return new Promise((resolve, reject) => {
      const configSocket = new Socket();
      let buffer = '';
      const areas: Record<string, VantageArea> = {};
      const devices: VantageDevice[] = [];

      this.config.log.info(`Attempting to connect to Vantage controller at ${this.config.ipAddress}:2001`);

      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        this.config.log.error(`Connection to ${this.config.ipAddress}:2001 timed out`);
        this.config.log.info('Please check if ports 2001 and 3001 are open on your Vantage controller');
        configSocket.destroy();
        this.emit('discoveryComplete', []);
        resolve();
      }, 10000); // 10 second timeout

      configSocket.connect({ host: this.config.ipAddress, port: 2001 }, () => {
        clearTimeout(connectionTimeout);
        this.config.log.info('Connected to Vantage controller for discovery');

        if (this.config.username && this.config.password) {
          this.config.log.debug('Sending authentication credentials');
          configSocket.write(`<ILogin><Login><call><User>${this.config.username}</User><Password>${this.config.password}</Password></call></Login></ILogin>\n`);
        } else {
          // If no authentication is needed, request the backup file directly
          this.config.log.debug('Requesting backup file');
          configSocket.write('<IBackup><GetFile><call>Backup\\Project.dc</call></GetFile></IBackup>\n');
        }
      });

      configSocket.on('data', (data) => {
        buffer += data.toString().replace('\ufeff', '');
        // this.config.log.debug(`Received data: ${buffer.length} bytes`);

        try {
          // Process the XML data
          if (buffer.includes('</IBackup>') || buffer.includes('</ILogin>')) {
            const parser = new XMLParser({
              ignoreAttributes: false,
              attributeNamePrefix: '_',
              isArray: (name) => ['Object'].includes(name),
              parseAttributeValue: true,
              trimValues: true,
              parseTagValue: true,
              allowBooleanAttributes: true
            });

            try {
              // Clean up the XML for parsing
              buffer = buffer.replace('<?File Encode="Base64" /', '<File>');
              buffer = buffer.replace('?>', '</File>');

              const result = parser.parse(buffer);

              // Handle login response
              if (result.ILogin?.Login?.return) {
                if (result.ILogin.Login.return === 'true') {
                  this.config.log.debug('Login successful');
                } else {
                  this.config.log.warn('Login failed, trying to get data anyway');
                }

                buffer = '';
                // Request the backup file
                this.config.log.debug('Requesting backup file');
                configSocket.write('<IBackup><GetFile><call>Backup\\Project.dc</call></GetFile></IBackup>\n');
                return;
              }

              // Handle backup file response
              if (result.IBackup?.GetFile?.return?.File) {
                // this.config.log.debug('Received backup file');

                // Decode the base64 file content
                const fileContent = Buffer.from(result.IBackup.GetFile.return.File, 'base64').toString('utf8');
                // this.config.log.debug(`Decoded file content: ${fileContent.length} bytes`);

                // Save the backup file to the user's home directory
                const fs = require('fs');
                const path = require('path');
                const homedir = require('os').homedir();
                const backupFilePath = path.join(homedir, 'vantage_backup.xml');

                try {
                  fs.writeFileSync(backupFilePath, fileContent);
                  this.config.log.info(`Saved backup file to ${backupFilePath}`);
                } catch (error) {
                  this.config.log.error(`Failed to save backup file: ${error.message}`);
                }

                // Process the file content to extract devices
                this.processBackupFile(fileContent, areas, devices);

                // Close the connection
                configSocket.end();
              } else {
                this.config.log.debug('Unrecognized response format');
              }
            } catch (parseError) {
              this.config.log.error('XML parsing error:', parseError);
              this.config.log.debug('XML content that failed to parse: ' + buffer.substring(0, 200) + '...');
            }
          }
        } catch (error) {
          this.config.log.error('Error parsing discovery data:', error);
        }
      });

      configSocket.on('error', (error) => {
        clearTimeout(connectionTimeout);
        this.config.log.error(`Discovery error: ${error.message}`);

        if (error.message.includes('ECONNREFUSED')) {
          this.config.log.info('Connection refused. Please check if port 2001 is open on your Vantage controller');
        } else if (error.message.includes('EHOSTUNREACH')) {
          this.config.log.info('Host unreachable. Please check your network connectivity');
        } else if (error.message.includes('ETIMEDOUT')) {
          this.config.log.info('Connection timed out. Please check your firewall settings');
        }

        this.emit('discoveryComplete', []);
        resolve();
      });

      configSocket.on('close', () => {
        clearTimeout(connectionTimeout);
        this.emit('discoveryComplete', devices);
        resolve();
      });
    });
  }

  private processBackupFile(fileContent: string, areas: Record<string, VantageArea>, devices: VantageDevice[]): void {
    try {
      // Clean up the file content
      fileContent = fileContent.replace(/[\r\n]/g, '');

      // Log a sample of the file content for debugging
      // this.config.log.debug(`File content sample: ${fileContent.substring(0, 500)}...`);

      // Extract all Area objects first using regex
      this.extractAreasDirectly(fileContent, areas);

      // Try to extract the Objects section
      let objectsXml = '';
      const objectsMatch = fileContent.match(/<Objects>(.*?)<\/Objects>/);

      if (objectsMatch) {
        objectsXml = `<Objects>${objectsMatch[1]}</Objects>`;
      } else {
        // Try an alternative approach - look for individual objects
        this.config.log.debug('Could not find Objects section, trying alternative approach');

        // Try to extract the Project section
        const projectMatch = fileContent.match(/<Project>(.*?)<\/Project>/);
        if (projectMatch) {
          objectsXml = `<Objects>${projectMatch[1]}</Objects>`;
        } else {
          this.config.log.error('Could not find Project or Objects section in backup file');
          return;
        }
      }

      // Parse the Objects XML
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '_',
        isArray: (name) => ['Object'].includes(name),
        parseAttributeValue: true,
        trimValues: true,
        parseTagValue: true,
        allowBooleanAttributes: true
      });

      let result;
      try {
        result = parser.parse(objectsXml);
      } catch (parseError) {
        this.config.log.error('Error parsing Objects XML:', parseError);

        // Try a more direct approach - just look for Load, Thermostat, etc. tags
        this.extractDevicesDirectly(fileContent, areas, devices);
        return;
      }

      if (!result.Objects || !result.Objects.Object) {
        this.config.log.error('No objects found in backup file');

        // Try a more direct approach
        this.extractDevicesDirectly(fileContent, areas, devices);
        return;
      }

      const objects = Array.isArray(result.Objects.Object) ? result.Objects.Object : [result.Objects.Object];

      this.config.log.debug(`Found ${objects.length} objects in backup file`);

      // FIRST PASS: Extract all Area objects
      this.config.log.info('First pass: Extracting Area objects...');
      objects.forEach(obj => {
        // Check if this is an Area object
        if (obj.Area && obj.Area.ObjectType === 'Area') {
          const areaObj = obj.Area;
          const vid = areaObj._VID || areaObj.VID || '';
          const areaName = areaObj.Name || areaObj.DName || 'Unknown';

          if (vid) {
            areas[vid] = {
              VID: vid,
              Name: areaName
            };
            // this.config.log.debug(`Found area: ${areaName} (VID: ${vid})`);
          }
        }
      });

      // Also look for standalone Area objects
      objects.forEach(obj => {
        if (obj.Area && !obj.Area.ObjectType && obj.Area._VID) {
          const vid = obj.Area._VID || '';
          const areaName = obj.Area.Name || obj.Area.DName || 'Unknown';

          if (vid && !areas[vid]) {
            areas[vid] = {
              VID: vid,
              Name: areaName
            };
            // this.config.log.debug(`Found standalone area: ${areaName} (VID: ${vid})`);
          }
        }
      });

      // If we still have no areas, try a different approach
      if (Object.keys(areas).length === 0) {
        // this.config.log.debug('No areas found with VIDs, trying alternative approach');

        // Try to extract areas directly from the objects
        objects.forEach(obj => {
          // Check if this is an area object
          if (obj.ObjectType === 'Area' || (obj.Area && obj.Area.ObjectType === 'Area')) {
            const target = obj.ObjectType === 'Area' ? obj : obj.Area;
            const vid = target._VID || target.VID || '';
            const areaName = target.Name || target.DName || 'Unknown';

            if (vid) {
              areas[vid] = {
                VID: vid,
                Name: areaName
              };
              // this.config.log.debug(`Found area (alt): ${areaName} (VID: ${vid})`);
            }
          }
        });
      }

      // Log all found areas
      this.config.log.info(`Found ${Object.keys(areas).length} areas in backup file`);
      for (const areaId of Object.keys(areas)) {
        // this.config.log.info(`Area: ${areas[areaId].Name} (VID: ${areaId})`);
      }

      // If we still have no areas, create a default one
      if (Object.keys(areas).length === 0) {
        const defaultAreaId = 'default_area';
        areas[defaultAreaId] = {
          VID: defaultAreaId,
          Name: 'Main Area'
        };
        // this.config.log.debug('Created default area');
      }

      // SECOND PASS: Extract all devices and connect them to areas
      this.config.log.info('Second pass: Extracting devices and connecting to areas...');
      const validTypes = ['Load', 'Thermostat', 'Blind', 'RelayBlind', 'QubeBlind'];
      const omitList = this.config.omit ? this.config.omit.split(',').map(id => id.trim()) : [];
      const rangeList = this.config.range ? this.config.range.split(',').map(id => parseInt(id.trim())) : [0, 999999999];

      objects.forEach(obj => {
        // Check if it's a device we're interested in
        let deviceType = '';
        let deviceData = null;

        // Try to determine the device type
        for (const type of validTypes) {
          if (obj[type]) {
            deviceType = type;
            deviceData = obj[type];
            break;
          }
        }

        if (!deviceType || !deviceData) {
          return; // Not a device we're interested in
        }

        // Get the VID - first try attribute, then element
        let vid = '';

        // Check for VID attribute
        if (deviceData._VID) {
          vid = deviceData._VID.toString();
        } else if (deviceData.VID) {
          vid = deviceData.VID.toString();
        }

        if (!vid) {
          return; // Skip devices without a VID
        }

        // Check if it's in the omit list or outside the range
        const numVid = parseInt(vid);
        if (omitList.includes(vid) || (!isNaN(numVid) && (numVid < rangeList[0] || numVid > rangeList[1]))) {
          return; // Skip this device
        }

        // Get the area for this device
        let areaId = '';

        // Try to get area from the device data
        if (deviceData.Area) {
          if (typeof deviceData.Area === 'string' || typeof deviceData.Area === 'number') {
            // Handle case where Area is just a number or string
            areaId = deviceData.Area.toString();
            // this.config.log.debug(`Device ${deviceData.Name} has simple Area reference: ${areaId}`);
          } else if (deviceData.Area._VID) {
            areaId = deviceData.Area._VID;
            // this.config.log.debug(`Device ${deviceData.Name} has Area._VID reference: ${areaId}`);
          } else if (deviceData.Area.VID) {
            areaId = deviceData.Area.VID;
            // this.config.log.debug(`Device ${deviceData.Name} has Area.VID reference: ${areaId}`);
          }
        }

        // Process the device
        const device: VantageDevice = {
          VID: vid,
          Name: deviceData.Name || deviceData.DName || `Unknown ${deviceType}`,
          ObjectType: deviceType,
          LoadType: deviceData.LoadType || '',
          DeviceCategory: deviceData.DeviceCategory || '',
          Area: areas[areaId]?.Name || 'Main Area'
        };

        // Debug log for area lookup
        // this.config.log.debug(`Device ${device.Name} (VID: ${device.VID}): Area ID lookup = ${areaId}, resolved to "${device.Area}"`);
        if (areaId && !areas[areaId]) {
          // this.config.log.debug(`  Area ID ${areaId} not found in areas map. Available area IDs: ${Object.keys(areas).join(', ')}`);
        }

        devices.push(device);
        // this.config.log.debug(`Found device: ${device.Name} (VID: ${device.VID}, Type: ${device.ObjectType}, Area: ${device.Area})`);
      });

      this.config.log.info(`Discovered ${devices.length} devices`);
    } catch (error) {
      this.config.log.error('Error processing backup file:', error);
      this.config.log.debug('Error details:', error.stack);

      // Try a more direct approach as a last resort
      this.extractDevicesDirectly(fileContent, areas, devices);
    }
  }

  private extractDevicesDirectly(fileContent: string, areas: Record<string, VantageArea>, devices: VantageDevice[]): void {
    try {
      this.config.log.debug('Extracting devices directly from file content');

      // Extract areas first if we don't have any yet
      if (Object.keys(areas).length === 0) {
        this.extractAreasDirectly(fileContent, areas);
      }

      // Extract devices
      const validTypes = ['Load', 'Thermostat', 'Blind', 'RelayBlind', 'QubeBlind'];
      const omitList = this.config.omit ? this.config.omit.split(',').map(id => id.trim()) : [];
      const rangeList = this.config.range ? this.config.range.split(',').map(id => parseInt(id.trim())) : [0, 999999999];
      let deviceCount = 0;

      for (const type of validTypes) {
        // Look for devices with VID attribute and Name
        const deviceRegex = new RegExp(`<${type}([^>]*)>.*?<Name>([^<]+)<\/Name>.*?<\\/${type}>`, 'g');
        let deviceMatch;

        while ((deviceMatch = deviceRegex.exec(fileContent)) !== null) {
          const attributes = deviceMatch[1] || '';
          const name = deviceMatch[2] || '';

          // Extract VID from attribute
          let vid = '';
          const vidAttributeMatch = /VID="([^"]+)"/.exec(attributes);
          if (vidAttributeMatch) {
            vid = vidAttributeMatch[1];
          } else {
            // Try to extract VID from element
            const vidElementMatch = /<VID>([^<]+)<\/VID>/.exec(deviceMatch[0]);
            if (vidElementMatch) {
              vid = vidElementMatch[1];
            } else {
              // Try to extract Number
              const numberMatch = /<Number>([^<]+)<\/Number>/.exec(deviceMatch[0]);
              if (numberMatch) {
                vid = numberMatch[1];
              } else {
                continue; // Skip if we couldn't extract VID
              }
            }
          }

          if (!name) {
            continue; // Skip if we couldn't extract name
          }

          // Check if it's in the omit list or outside the range
          const numVid = parseInt(vid);
          if (omitList.includes(vid) || (!isNaN(numVid) && (numVid < rangeList[0] || numVid > rangeList[1]))) {
            continue; // Skip this device
          }

          // Extract area name if available
          let areaId = '';

          // Look for <Area>number</Area> format - this is the most common format for Load objects
          const areaElementMatch = deviceMatch[0].match(/<Area>([^<]+)<\/Area>/);
          if (areaElementMatch) {
            areaId = areaElementMatch[1];
            // this.config.log.debug(`Found area reference in device ${name} (VID: ${vid}): ${areaId}`);
          }

          // Debug area lookup
          // this.config.log.debug(`Direct extraction - Device ${name} (VID: ${vid}): Area ID lookup = ${areaId}`);
          if (areaId && !areas[areaId]) {
            // this.config.log.debug(`  Area ID ${areaId} not found in areas map. Available area IDs: ${Object.keys(areas).join(', ')}`);
          }

          // Extract load type if available
          let loadType = '';
          const loadTypeMatch = deviceMatch[0].match(/<LoadType>([^<]+)<\/LoadType>/);
          if (loadTypeMatch) {
            loadType = loadTypeMatch[1];
          }

          // Extract device category if available
          let deviceCategory = '';
          const deviceCategoryMatch = deviceMatch[0].match(/<DeviceCategory>([^<]+)<\/DeviceCategory>/);
          if (deviceCategoryMatch) {
            deviceCategory = deviceCategoryMatch[1];
          }

          const device: VantageDevice = {
            VID: vid,
            Name: name,
            ObjectType: type,
            LoadType: loadType,
            DeviceCategory: deviceCategory,
            Area: areas[areaId]?.Name || 'Main Area'
          };

          devices.push(device);
          deviceCount++;
          // this.config.log.debug(`Found device (direct): ${name} (VID: ${vid}, Type: ${type}, Area: ${device.Area})`);
        }
      }

      this.config.log.info(`Discovered ${deviceCount} devices using direct extraction`);
    } catch (error) {
      this.config.log.error('Error extracting devices directly:', error);
      this.config.log.debug('Error details:', error.stack);
    }
  }

  private isValidDevice(obj: any): boolean {
    const validTypes = ['Load', 'Thermostat', 'Blind', 'RelayBlind', 'QubeBlind'];

    // Check if the object has a valid type
    if (!obj || !obj.ObjectType) {
      return false;
    }

    // Check if it's one of our supported types
    if (!validTypes.includes(obj.ObjectType)) {
      return false;
    }

    // Make sure it has a VID
    if (!obj.VID) {
      return false;
    }

    return true;
  }

  private processDevice(device: any, areas: Record<string, VantageArea>): VantageDevice {
    try {
      // Extract name from the most likely locations
      const name = device.DName || device.Name || '';

      const processedDevice: VantageDevice = {
        VID: device.VID || '',
        Name: name || `Unknown ${device.ObjectType}`,
        ObjectType: device.ObjectType || '',
        LoadType: device.LoadType || '',
        DeviceCategory: device.DeviceCategory || '',
      };

      // Add area information if available
      const areaId = device.Area;
      if (areaId && areas[areaId]) {
        processedDevice.Area = areas[areaId].Name;
      } else if (areaId) {
        // If we have an area ID but no matching area, use the ID as the area name
        processedDevice.Area = `Area ${areaId}`;
      } else {
        // Default area name if none is found
        processedDevice.Area = 'Main Area';
      }

      // this.config.log.debug(`Processed device: ${JSON.stringify(processedDevice)}`);
      return processedDevice;
    } catch (error) {
      this.config.log.error('Error processing device:', error);
      // this.config.log.debug('Device data:', JSON.stringify(device));

      // Return a minimal valid device to avoid crashes
      return {
        VID: device.VID || '',
        Name: device.Name || `Unknown ${device.ObjectType || 'Device'}`,
        ObjectType: device.ObjectType || 'Unknown',
        Area: 'Main Area',
      };
    }
  }

  public getLoadStatus(vid: string): void {
    this.commandSocket.write(sprintf('GETLOAD %s\n', vid));
  }

  public setLoadLevel(vid: string, level: number, time = 1): void {
    // Always use the Load.Ramp command for consistency with the original implementation
    this.commandSocket.write(sprintf('INVOKE %s Load.Ramp 6 %s %s\n', vid, time, level));
  }

  public setBlindPosition(vid: string, position: number): void {
    this.commandSocket.write(sprintf('BLIND %s POS %s\n', vid, position));
  }

  public getThermostatState(vid: string): void {
    this.commandSocket.write(sprintf('INVOKE %s Thermostat.GetIndoorTemperature\n', vid));
    this.commandSocket.write(sprintf('GETTHERMOP %s\n', vid));
    this.commandSocket.write(sprintf('GETTHERMTEMP %s HEAT\n', vid));
    this.commandSocket.write(sprintf('GETTHERMTEMP %s COOL\n', vid));
  }

  public setThermostatMode(vid: string, mode: number): void {
    const modeMap = {
      0: 'OFF',
      1: 'HEAT',
      2: 'COOL',
      3: 'AUTO',
    };
    this.commandSocket.write(sprintf('THERMOP %s %s\n', vid, modeMap[mode] || 'OFF'));
  }

  public setThermostatTemperature(
    vid: string,
    value: number,
    mode: number,
    heating: number,
    cooling: number
  ): void {
    if (mode === 1) {
      this.commandSocket.write(sprintf('THERMTEMP %s HEAT %s\n', vid, value));
    } else if (mode === 2) {
      this.commandSocket.write(sprintf('THERMTEMP %s COOL %s\n', vid, value));
    } else if (mode === 3) {
      if (value > cooling) {
        this.commandSocket.write(sprintf('THERMTEMP %s COOL %s\n', vid, value));
      } else if (value < heating) {
        this.commandSocket.write(sprintf('THERMTEMP %s HEAT %s\n', vid, value));
      }
    }
  }

  public getBlindPosition(vid: string): void {
    this.commandSocket.write(sprintf('GETBLIND %s\n', vid));
  }

  private setupReconnection(): void {
    this.commandSocket.on('close', () => {
      this.config.log.warn('Connection closed, attempting to reconnect...');
      setTimeout(() => {
        this.commandSocket.connect({
          host: this.config.ipAddress,
          port: 3001
        });
      }, 5000); // Retry every 5 seconds
    });
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString();
  }

  private logDeviceSamples(fileContent: string): void {
    const validTypes = ['Load', 'Thermostat', 'Blind', 'RelayBlind', 'QubeBlind', 'Area'];

    for (const type of validTypes) {
      const regex = new RegExp(`<${type}[^>]*>.*?<\\/${type}>`, 's');
      const match = regex.exec(fileContent);

      if (match) {
        this.config.log.info(`Sample ${type} XML structure:`);
        this.config.log.info(match[0].substring(0, 500) + (match[0].length > 500 ? '...' : ''));

        // Try to extract VID from attribute
        const vidAttributeMatch = new RegExp(`<${type}[^>]*VID="([^"]+)"[^>]*>`, 's').exec(match[0]);
        // Also try to extract VID from element
        const vidElementMatch = /<VID>([^<]+)<\/VID>/.exec(match[0]);
        const nameMatch = /<Name>([^<]+)<\/Name>/.exec(match[0]);
        const numberMatch = /<Number>([^<]+)<\/Number>/.exec(match[0]);

        this.config.log.info(`${type} VID (attribute): ${vidAttributeMatch ? vidAttributeMatch[1] : 'Not found'}`);
        this.config.log.info(`${type} VID (element): ${vidElementMatch ? vidElementMatch[1] : 'Not found'}`);
        this.config.log.info(`${type} Name: ${nameMatch ? nameMatch[1] : 'Not found'}`);
        this.config.log.info(`${type} Number: ${numberMatch ? numberMatch[1] : 'Not found'}`);

        // For Load type, also check LoadType
        if (type === 'Load') {
          const loadTypeMatch = /<LoadType>([^<]+)<\/LoadType>/.exec(match[0]);
          this.config.log.info(`Load LoadType: ${loadTypeMatch ? loadTypeMatch[1] : 'Not found'}`);
        }
      } else {
        this.config.log.info(`No ${type} objects found in the file`);
      }
    }
  }

  private extractAreasDirectly(fileContent: string, areas: Record<string, VantageArea>): void {
    // Extract only top-level Area objects with VID attributes
    const areaRegex = /<Object>\s*<Area\s+VID="([^"]+)"[^>]*>.*?<Name>([^<]+)<\/Name>.*?<\/Area>\s*<\/Object>/g;
    let areaMatch;
    let areaCount = 0;

    while ((areaMatch = areaRegex.exec(fileContent)) !== null) {
      const vid = areaMatch[1];
      const name = areaMatch[2];

      if (vid && !areas[vid]) {
        areas[vid] = {
          VID: vid,
          Name: name
        };
        areaCount++;
        // this.config.log.debug(`Found top-level area: ${name} (VID: ${vid})`);
      }
    }

    // If we still have no areas, create a default one
    if (Object.keys(areas).length === 0) {
      const defaultAreaId = 'default_area';
      areas[defaultAreaId] = {
        VID: defaultAreaId,
        Name: 'Main Area'
      };
      // this.config.log.debug('Created default area');
      areaCount++;
    }

    this.config.log.info(`Found ${areaCount} top-level areas using direct extraction`);
  }

  // ... other methods to be continued
}
