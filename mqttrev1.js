
// [START iot_mqtt_include]
const fs = require('fs');
const jwt = require('jsonwebtoken');
const mqtt = require('mqtt');
// [END iot_mqtt_include]

console.log('Google Cloud IoT Core MQTT example.');
var argv = require(`yargs`)
    .options({
      project_id: {
        default: 'topgun-190505' || 'topgun-190505',
        description: 'The Project ID to use. Defaults to the value of the topgun-190505.',
        requiresArg: true,
        type: 'string'
      },
      cloud_region: {
        default: 'asia-east1',
        description: 'GCP cloud region.',
        requiresArg: true,
        type: 'string'
      },
      registry_id: {
        description: 'Cloud IoT registry ID',
        requiresArg: true,
        demandOption: true,
        type: 'string'
      },
      device_id: {
        description: 'Cloud IoT device ID.',
        requiresArg: true,
        demandOption: true,
        type: 'string'
      },
      private_key_file: {
        description: 'Path to private key file.',
        requiresArg: true,
        demandOption: true,
        type: 'string'
      },
      algorithm: {
        description: 'Encryption algorithm to generate the JWT.',
        requiresArg: true,
        demandOption: true,
        choices: ['RS256', 'ES256'],
        type: 'string'
      },
      num_messages: {
        default: 20,
        description: 'Number of messages to publish.',
        requiresArg: true,
        type: 'number'
      },
      token_exp_mins: {
        default: 20,
        description: 'Minutes to JWT token expiration.',
        requiresArg: true,
        type: 'number'
      },
      mqtt_bridge_hostname: {
        default: 'mqtt.googleapis.com',
        description: 'MQTT bridge hostname.',
        requiresArg: true,
        type: 'string'
      },
      mqtt_bridge_port: {
        default: 8883,
        description: 'MQTT bridge port.',
        requiresArg: true,
        type: 'number'
      },
      message_type: {
        default: 'events',
        description: 'Message type to publish.',
        requiresArg: true,
        choices: ['events', 'state'],
        type: 'string'
      }
    })
    .example(`node $0 cloudiot_mqtt_example_nodejs.js --project_id=blue-jet-123 --registry_id=my-registry --device_id=my-node-device --private_key_file=../rsa_private.pem --algorithm=RS256`)
    .wrap(120)
    .recommendCommands()
    .epilogue(`For more information, see https://cloud.google.com/iot-core/docs`)
    .help()
    .strict()
    .argv;

// Create a Cloud IoT Core JWT for the given project id, signed with the given
// private key.
// [START iot_mqtt_jwt]
function createJwt (projectId, privateKeyFile, algorithm) {
  // Create a JWT to authenticate this device. The device will be disconnected
  // after the token expires, and will have to reconnect with a new token. The
  // audience field should always be set to the GCP project id.
  const token = {
    'iat': parseInt(Date.now() / 1000),
    'exp': parseInt(Date.now() / 1000) + 20 * 60,  // 20 minutes
    'aud': projectId
  };
  const privateKey = fs.readFileSync(privateKeyFile);
  return jwt.sign(token, privateKey, { algorithm: algorithm });
}
// [END iot_mqtt_jwt]

// Publish numMessages messages asynchronously, starting from message
// messageCount.
// [START iot_mqtt_publish]
function publishAsync (messageCount, numMessages) {
  const payload = `{"DATA":"${argv.registry_id}","ATTRIBUTES":"${argv.device_id}","MESSAGE_ID":"${messageCount}","Timestamp":"${getDateTime()}",${mySeq()}}`;
  // Publish "payload" to the MQTT topic. qos=1 means at least once delivery.
  // Cloud IoT Core also supports qos=0 for at most once delivery.
  console.log('Publishing message:', payload);
  client.publish(mqttTopic, payload, { qos: 1 });

  const delayMs = argv.message_type === 'events' ? 1800000 : 2000000;
  if (messageCount < numMessages) {
    // If we have published fewer than numMessage messages, publish payload
    // messageCount + 1 in 1 second.
    setTimeout(function () {
      let secsFromIssue = parseInt(Date.now() / 1000) - iatTime;
      if (secsFromIssue > argv.token_exp_mins * 60) {
        iatTime = parseInt(Date.now() / 1000);
        console.log(`\tRefreshing token after ${secsFromIssue} seconds.`);

        client.end();
        connectionArgs.password = createJwt(argv.project_id, argv.private_key_file, argv.algorithm);
        client = mqtt.connect(connectionArgs);

        client.on('connect', () => {
          console.log('connect', arguments);
        });

        client.on('close', () => {
          console.log('close', arguments);
        });

        client.on('error', () => {
          console.log('error', arguments);
        });

        client.on('packetsend', () => {
          // Too verbose to log here
        });
      }
      publishAsync(messageCount + 1, numMessages);
    }, delayMs);
  } else {
    // Otherwise, close the connection.
    console.log('Closing connection to MQTT. Goodbye!');
    client.end();
  }
}
// [END iot_mqtt_publish]

// [START iot_mqtt_run]
// The mqttClientId is a unique string that identifies this device. For Google
// Cloud IoT Core, it must be in the format below.
const mqttClientId = `projects/${argv.project_id}/locations/${argv.cloud_region}/registries/${argv.registry_id}/devices/${argv.device_id}`;

// With Google Cloud IoT Core, the username field is ignored, however it must be
// non-empty. The password field is used to transmit a JWT to authorize the
// device. The "mqtts" protocol causes the library to connect using SSL, which
// is required for Cloud IoT Core.
let connectionArgs = {
  host: argv.mqtt_bridge_hostname,
  port: argv.mqtt_bridge_port,
  clientId: mqttClientId,
  username: 'unused',
  password: createJwt(argv.project_id, argv.private_key_file, argv.algorithm),
  protocol: 'mqtts',
  secureProtocol: 'TLSv1_2_method'
};

// Create a client, and connect to the Google MQTT bridge.
let iatTime = parseInt(Date.now() / 1000);
let client = mqtt.connect(connectionArgs);

// The MQTT topic that this device will publish data to. The MQTT
// topic name is required to be in the format below. The topic name must end in
// 'state' to publish state and 'events' to publish telemetry. Note that this is
// not the same as the device registry's Cloud Pub/Sub topic.
const mqttTopic = `/devices/${argv.device_id}/${argv.message_type}`;

client.on('connect', () => {
  console.log('connect', arguments);
  // After connecting, publish 'num_messages' messagse asynchronously, at a rate
  // of 1 per second for telemetry events and 1 every 2 seconds for states.
  publishAsync(1, argv.num_messages);
});


// Once all of the messages have been published, the connection to Google Cloud
// IoT will be closed and the process will exit. See the publishAsync method.
// [END iot_mqtt_run]


// this code is to generate the time stamp
function getDateTime() {

    var date = new Date();
    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;
    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;
    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;
    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;
    return year + "-" + month + "-" + day + "T" + hour + ":" + min + ":" + sec;
};

// this code is to generate random signal data
var precision = 2;

//coolant level range unit: %
var cool_lvl_min = 90;
var cool_lvl_max = 100;

//Coolant temperature unit: DegC
var cool_temp_min = 70;
var cool_temp_max = 75;

//oil pressure unit: bar
var oil_P_min = 1.0;
var oil_P_max = 1.5;

//battery capacity: %
var bat_cap_min = 80;
var bat_cap_max = 83;

//Power output: MW
var power_out_min = 5;
var power_out_max = 7;

// Efficiency: %
var eff_out_min = 30;
var eff_out_max = 33;

function mySeq (){
//for (var i = 0; i < 10; i++){
var cool_lvl = randomMinMax(cool_lvl_min, cool_lvl_max, precision);

var cool_temp = randomMinMax(cool_temp_min, cool_lvl_max, precision);

var oil_P = randomMinMax(oil_P_min, oil_P_max, precision);

var bat_cap = randomMinMax(bat_cap_min, bat_cap_max, precision);

var power_out = randomMinMax(power_out_min, power_out_max, precision);

var eff_out = randomMinMax(eff_out_min, eff_out_max, precision);

const data_payload = `"cool_lvl":"${cool_lvl}","cool_temp":"${cool_temp}","oil_P":"${oil_P}","power_out":"${power_out}","eff_out":"${eff_out}","bat_cap":"${bat_cap}"`;

return data_payload;

};

function randomMinMax(min,max,precision){
  number = Math.random()*(max-min)+min;
  var factor = Math.pow(10, precision);
  return Math.round(number * factor) / factor;
};
