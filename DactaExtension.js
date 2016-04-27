/**
 * Allow interaction with Lego 9751 / 70909 command module.
 *
 * Port of Lego@shamlian.net python control software to Scratch extension.
 */

(function (ext) {
    var _INIT_ON     = "p\0";
    var _INIT_START  = "###Do you byte, when I knock?$$$";
    var _INIT_RETURN = "###Just a bit off the block!$$$";

    // Commands from http://www.blockcad.net/dacta/
    var CMD_NOP      = 0x02,
        CMD_PORTONL  = 0x10,
        CMD_PORTONR  = 0x18,
        CMD_PORTREV  = 0x20,
        CMD_PORTONX  = 0x28,
        CMD_PORTOFF  = 0x30, // check to see if low nibble does anything
        CMD_PORTDRL  = 0x40,
        CMD_PORTDRR  = 0x48,
        CMD_KILLALL  = 0x70; // completely disconnects interface
    var _PARAM_POWER = 0xb0;

    var _sensorValues = [0, 0, 0, 0, 0, 0, 0, 0];
    var _sensorStatus = [0, 0, 0, 0, 0, 0, 0, 0];
    var _rotations    = [0, 0, 0, 0, 0, 0, 0, 0];

    var PORT_A = 0,
        PORT_B = 1,
        PORT_C = 2,
        PORT_D = 3,
        PORT_E = 4,
        PORT_F = 5,
        PORT_G = 6,
        PORT_H = 7,
        PORT_1 = 0,
        PORT_2 = 1,
        PORT_3 = 2,
        PORT_4 = 3,
        PORT_5 = 4,
        PORT_6 = 5,
        PORT_7 = 6,
        PORT_8 = 7;

    var device = null;
    var potentialDevices = [];
    var rawData = null;
    var confirming = 1;

    // Wrapper that will also print out the opcodes being sent to the browser console.
    function sendToDacta(cmd) {
	if (cmd.length > 1) {
	    console.log("Sending " + Array.apply([], cmd).join(","));
	}
	else {
	    console.log("Sending " + cmd[0]);
	}
        device.send(cmd.buffer);
    }

    function sendStringToDacta(str) {
        console.log(str);
        var buf = new ArrayBuffer(str.length);
        var bufView = new Uint8Array(buf);
        for (var i=0, strLen=str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        sendToDacta(bufView);
    }

    function getValue(port) {
        portIndex = (port - '1') & 7;
        return _sensorValues[portIndex];
    }
    ext.portValue = function (port) {
        return getValue(port);
    };

    function getStatus(port) {
        portIndex = (port - '1') & 7;
        return _sensorStatus[portIndex];
    }
    ext.portStatus = function (port) {
        return getStatus(port);
    };

    function getRotation(port) {
        portIndex = (port - '1') & 7;
        return _rotations[portIndex];
    }
    ext.portRotation = function (port) {
        return getRotation(port);
    };

    ext.clearRotation = function (port) {
        portIndex = (port - '1') & 7;
        _rotations[portIndex] = 0;
    };

    ext.isPressed = function (port) {
        if (getValue(port) < 700) { return true; }
        return false;
    };

    ext.getTempC = function (port) {
        return ((760.0 - getValue(port)) / 4.4) * 5.0/9.0;
    };


    ext.whenPortValuePass = function (port, sign, level) {
        if (sign === '<') {
            return getValue(port) < level;
        }
        else if (sign === '>') {
            return getValue(port) > level;
        }
        else {
            return getValue(port) === level;
        }
    };


    // Commands
	
    function sendPortCmd(port, cmd)  {
	powerCommand = false;
	switch(cmd)
	{
	case 'Direction left':
	    cmd = CMD_PORTDRL;
	    break;
        case 'Direction right':
	    cmd = CMD_PORTDRR;
	    break;
	case 'On left':
	    cmd = CMD_PORTONL;
	    break;
	case 'On right':
	    cmd = CMD_PORTONR;
	    break;
	case 'On':
	    cmd = CMD_PORTONX;
	    break;
	case 'Reverse':
	    cmd = CMD_PORTREV;
	    break;
	case 'Off':
	    cmd = CMD_PORTOFF;
	    break;
	case _PARAM_POWER:
	    powerCommand = true;
	    portIndex = port;  // Power level
	    break;
	default:
	    console.log("Invalid port command");
	    break;
	}
		
	if (!powerCommand) {
	    portIndex = (port.charCodeAt(0) - 'A'.charCodeAt(0)) & 7;
	}
		
        sendToDacta(new Uint8Array([(cmd | portIndex)]));
    };

    ext.sendPortCmdB = function(port, cmd) {
        sendPortCmd(port, cmd);
    };

    ext.setPower = function(port, level) {
	if (level > 7) {
	    alert("level must be below 7");
	    return;
	}
        portIndex = (port.charCodeAt(0) - 'A'.charCodeAt(0)) & 7;
        var cmdToSend = new Uint8Array([(1 <<  portIndex)]);
		
	sendPortCmd(level, _PARAM_POWER);
        sendToDacta(cmdToSend);
    };

    function decodeInput(portIndex, b1, b2) {
        value = (b1 << 2) | ((b2 >> 6) & 0x03);
        state = b2 & 0x3F;
        change = state & 3;
        if (state & 4 === 0) {
            change *= -1;
        }
        _sensorValues[portIndex] = value;
        _sensorStatus[portIndex] = state;
        _rotations[portIndex]   += change;
    }

    var confirmIndex = 0;
    var countA = 0;
    function processConfirmation(dataByte) {
        // Check if byte is correct
        if (dataByte === _INIT_RETURN.charCodeAt(confirmIndex)) {
            confirmIndex++;

            if (confirmIndex >= _INIT_RETURN.length) {
                // Confirmation received. Run normally now.
                if (watchdog) {
                    console.log("Dacta verified. Clearing watchdog");
                    clearTimeout(watchdog);
                    watchdog = null;
                    confirming = 0;
		    taskKeepAlive();
                }
            }
        }
        else {  // Byte was incorrect.
            confirmIndex = 0;
        }
    }


    function processInput(inputData) {
        for (var i=0; i < inputData.length; i++) {
            if (confirming) {
                processConfirmation(inputData[i]);
            }
            else {
                // Collect data
                if (!rawData) {
                    var pktStart = inputData.indexOf(0);
                    // First two bytes should be 0.
                    if ((pktStart >= 0) && (inputData[pktStart+1] === 0)) {
                        while (inputData[pktStart+2] === 0) {
                            pktStart++;
                        }
                        rawData = new Uint8Array(inputData.slice(pktStart));
                    }
                }
                else {
                    rawData = appendBuffer(rawData, inputData);
                }
                
                if (rawData) {
                    // Check if data is long enough and pkt start is there.
                    if (rawData.byteLength >= 19) {
                        var checksum = 0;
                        // Check checksum
                        for (var j=0; j < rawData.byteLength; j++) {
                            checksum += rawData[j];
                        }
                
                        if ((checksum & 0xff) === 0xff) {
                            console.log("got a packet");
                            // Now that data is collected, decode it. (THE ORDER OF DATA KILLS ME)
                            decodeInput(0, rawData[14], rawData[15]);
                            decodeInput(1, rawData[10], rawData[11]);
                            decodeInput(2, rawData[6],  rawData[7]);
                            decodeInput(3, rawData[2],  rawData[3]);
                            decodeInput(4, rawData[16], rawData[17]);
                            decodeInput(5, rawData[12], rawData[13]);
                            decodeInput(6, rawData[8],  rawData[9]);
                            decodeInput(7, rawData[4],  rawData[5]);
                        }
                        else { // Bad data, reject
                            rawData = null;
                        }
                    }
                }
            }
        }
        inputData = null;
    }


    function appendBuffer( buffer1, buffer2 ) {
        var tmp = new Uint8Array( buffer1.byteLength + buffer2.byteLength );
        tmp.set( new Uint8Array( buffer1 ), 0 );
        tmp.set( new Uint8Array( buffer2 ), buffer1.byteLength );
        return tmp;
    }

    ext.whenDeviceConnected = function() {
        if (device) { return true; }
        return false;
    };
    

    ext._deviceConnected = function(dev) {
        potentialDevices.push(dev);

        console.info("Device plugged in " + dev.id);
        if (!device)
        {
            tryNextDevice();
        }
	else {
	    console.log("no device...");
	}
    }

    function tryNextDevice() {
        device = potentialDevices.shift();

        if (device)
        {
            console.info("Trying to open device " + device.id);
            confirming = 1;
            device.open({ stopBits: 0, bitRate: 9600, ctsFlowControl: 0 }, deviceOpened);
        }
    }

    function taskKeepAlive() {
	if (!confirming) {
	    console.log("keep alive");
	    device.send(CMD_NOP);
	}
		
	setTimeout(function() {
	    taskKeepAlive();
	}, 1900);
    }

    var watchdog = null;
    function deviceOpened(dev) {
        if (!dev) {
            // Opening the port failed
            tryNextDevice();
            return;
        }

        // Receive streamed data. This script is not set up to handle
        // non-streamed data!
        device.set_receive_handler(function(data) {
            if (data.byteLength > 0) {
                var inputData = new Uint8Array(data);
                processInput(inputData);
            }
        });

        watchdog = setTimeout(function() {
            // This device didn't get good data in time, so give up on
            // it. Clean up and then move on. If we get good data
            // then we'll terminate this watchdog.
            device.set_receive_handler(null);
            device.close();
            device = null;
            tryNextDevice();
        }, 3000); // Give 3 seconds to respond with a complete packet

        sendStringToDacta(_INIT_ON);
        sendStringToDacta(_INIT_START);
    };
    

    ext._deviceRemoved = function (dev) {
        console.warn("Device removed");
        if(device !== dev) return;
        device = null;
        rawData = null;
    };

    function disconnectDacta() {
        sendToDacta(new Uint8Array([CMD_KILLALL]));
        device.close();
        device = null;
    }

    ext.disconnect = function() {
        if (device) disconnectDacta();
        device = null;
        rawData = null;
    }

    ext._shutdown = function() {
        console.info("shutdown...");
        if(device) disconnectDacta();
        device = null;
        rawData = null;
    };

    ext._getStatus = function () {
        if(!device) return {status: 1, msg: 'Dacta disconnected'};
        if(watchdog) return {status: 1, msg: 'Looking for Dacta'};
        return {status: 2, msg: 'Dacta connected'};
    };



    var descriptor = {
        // [ Type, String, Callback, Default menu values ]
        // Types: 
        // ' ' 	Synchronous command
        // 'w' 	Asynchronous command
        // 'r' 	Synchronous reporter
        // 'R' 	Asynchronous reporter
        // 'h' 	Hat block (synchronous, returns boolean, true = run stack)

        blocks: [
            ['h', 'when %m.inPorts value %m.lessMore %n', 'whenPortValuePass', '1', '>', 0],
            ['h', 'when %m.inPorts is pressed', 'isPressed', '1'],

            ['r', 'port %m.inPorts value', 'portValue', '1'],
            ['r', 'port %m.inPorts status', 'portValue', '1'],
            ['r', 'port %m.inPorts rotation', 'portRotation', '1'],
            ['r', 'port %m.inPorts temperature in Celsius', 'getTempC', '1'],

            [' ', 'clear port %m.inPorts rotation', 'clearRotation', '1'],

            // Commands
            [' ', 'Send to Port %m.outPorts command %m.PortCmds', 'sendPortCmdB', 'A', 'Direction left'],
            [' ', 'Set port %m.outPorts to power %n', 'setPower', 'A', '0']
        ],
        menus: {
            outPorts:       [ 'A',
                              'B',
                              'C',
                              'D',
                              'E',
                              'F',
                              'G',
                              'H'
                            ],
	    inPorts:        [ '1',
                              '2',
                              '3',
                              '4',
                              '5',
                              '6',
                              '7',
                              '8'
                            ],
            PortCmds:       [ 'Direction left',
                              'Direction right',
                              'Off',
                              'On left',
                              'On right',
                              'On',
                              'Reverse'
                            ],
            lessMore:       [ '>', '<', '=' ],
        },
        url: 'http://...?'
    };
    ScratchExtensions.register('Lego Dacta', descriptor, ext, {type: 'serial'});
})({});
