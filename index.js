
const hashPrecision = 3;
const dedupeMinutes = 10;


const aprs = require('aprs-parser');
const Push = require('pushover-notifications');
const ngeohash = require('ngeohash');
const geolib = require('geolib');
const NodeCache = require('node-cache');
const moment = require('moment');

const pushCache = new NodeCache({ stdTTL: dedupeMinutes*60});

const get = (p, o) => {
    if (!Array.isArray(p)) p = p.split('.');
    return p.reduce((xs, x) => (xs && xs[x]) ? xs[x] : null, o);
};

let pushUsers;
try {
    pushUsers = JSON.parse(require('fs').readFileSync('./config.json'));
} catch (e) {
    console.log('Unable to read config.json');
    process.exit(1);
}

const geoObj = {};

console.log('Building geohash cache...');
for (let i = 0; i < pushUsers.beacons.length; i++){
    const hash = ngeohash.encode(pushUsers.beacons[i].myLat, pushUsers.beacons[i].myLong, hashPrecision);
    console.log(`Assigning hash "${hash}" to array element ${i}`);
    geoObj[hash] = i;
}

const getCall = event => {
    if (event.from.ssid) {
        return event.from.call + '-' + event.from.ssid;
    } else {
        return event.from.call;
    }
};

const getRadio = event => {
    if (event && event.data && event.data.radio) {
        return ` (${event.data.radio})`;
    }
    return '';
};

const getComment = event => {
    if (event && event.data && event.data.comment) {
        return ` (${event.data.comment.trim()})`;
    }
    return '';
};

const getRoundedDistance = distance => {
    return Math.round(distance * 10) / 10;
};

const getMsg = (msg, distance, direction, event) => {
    const now = moment().format('MMM Do h:mm:ss A');
    if (direction) {
        return `${now}: ${msg}: ${getCall(event)} is ${getRoundedDistance(distance)} mi ${direction}${getRadio(event)}${getComment(event)}`;
    } else {
        return `${now}: ${msg}: ${getCall(event)} is ${getRoundedDistance(distance)} mi ${getRadio(event)}${getComment(event)}`;
    }

};

const processEvent = event => {
    const lat = get('data.latitude', event);
    const long = get('data.longitude', event);
    if (!lat || !long) return;
    const location = ngeohash.encode(lat, long, hashPrecision);
    if (typeof geoObj[location] == 'undefined') return;
    const currentElement = pushUsers.beacons[geoObj[location]];
    let distance = geolib.getDistance(
        { latitude: lat, longitude: long },
        { latitude: currentElement.myLat, longitude: currentElement.myLong }
    );
    const direction = geolib.getCompassDirection( { latitude: currentElement.myLat, longitude: currentElement.myLong },{ latitude: lat, longitude: long });
    distance = distance * 0.000621371; //m to mi
    if (currentElement.exclude.indexOf(getCall(event)) > -1) {
        console.log(getMsg('Excluded beacon', distance, direction, event));
    } else if (pushCache.get(getCall(event))) {
        console.log(getMsg('Duplicate beacon', distance, direction, event));
    } else if (distance < currentElement.reportCloserThanDistanceMiles) {
        const push = new Push({ user: currentElement.pushoverUser, token: currentElement.pushoverTokenUser });
        const msg = getMsg('APRS beacon', distance, direction, event);
        console.log(msg);
        push.send({
            message: msg,
            priority: 1
        }, (err) => {
            if (err) {
                console.log('Error sending push notification: ' + err);
            } else {
                pushCache.set(getCall(event), new Date().toISOString());
            }
        });
    } else {
        console.log(getMsg(`Nearby geohash ${location} but not close enough to send a push notification`, distance, direction, event));
    }

};


const stream = new aprs.APRSISConnector;
stream.connect(pushUsers.myCall);
console.log('Connected to APRS firehose');
stream.on('aprs', processEvent);
