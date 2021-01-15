
const hashPrecision = 3;
const nearbyDedupeMinutes = 10;
const includesDedupeMinutes = 30;


const aprs = require('aprs-parser');
const Push = require('pushover-notifications');
const ngeohash = require('ngeohash');
const geolib = require('geolib');
const NodeCache = require('node-cache');
const moment = require('moment');

const nearbyCache = new NodeCache({ stdTTL: nearbyDedupeMinutes * 60 });
const includesCache = new NodeCache({ stdTTL: includesDedupeMinutes*60});

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
const includeObj = {};

console.log('Building geohash & include cache...');
Object.keys(pushUsers.beacons).forEach((el) => {
    const hash = ngeohash.encode(pushUsers.beacons[el].myLat, pushUsers.beacons[el].myLong, hashPrecision);
    console.log(`Assigning hash "${hash}" to key ${el}`);
    if (typeof geoObj[hash] == 'undefined') geoObj[hash] = [];
    pushUsers.beacons[el].prefix = el;
    geoObj[hash].push(el);
    if (pushUsers.beacons[el].include) {
        for (let p = 0; p < pushUsers.beacons[el].include.length; p++){
            console.log(`Assigning include "${pushUsers.beacons[el].include[p]}" to key ${el}`);
            if (typeof includeObj[pushUsers.beacons[el].include[p]] == 'undefined') includeObj[pushUsers.beacons[el].include[p]] = [];
            includeObj[pushUsers.beacons[el].include[p]].push(el);
        }
    }
});





const getCall = event => {
    if (event.from.ssid) {
        return event.from.call + '-' + event.from.ssid;
    } else {
        return event.from.call;
    }
};

const getRadio = event => {
    if (event && event.data && event.data.radio) {
        return `(${event.data.radio})`;
    }
    return '';
};

const getComment = event => {
    if (event && event.data && event.data.comment) {
        return `(${event.data.comment.trim()})`;
    }
    return '';
};

const getRoundedDistance = distance => {
    return Math.round(distance * 10) / 10;
};

const getMsg = (msg, pfx, distance, direction, event) => {
    const now = moment().format('MMM Do h:mm:ss A');
    let rtn;
    if (direction) {
        rtn =  `${now}: ${pfx} ${msg}: ${getCall(event)} is ${getRoundedDistance(distance)} mi ${direction} ${getRadio(event)} ${getComment(event)}`;
    } else {
        rtn = `${now}: ${pfx} ${msg}: ${getCall(event)} is ${getRoundedDistance(distance)} mi ${getRadio(event)} ${getComment(event)}`;
    }
    rtn = rtn.replace(/\s\s+/g, ' ');
    return rtn;
};


const sendPush = (user, token, msg, cb) => {
    const push = new Push({ user, token });
    push.send({
        message: msg,
        priority: 1
    }, (err) => {
        if (err) console.log('Error sending push notification: ' + err);
        return cb(err);
    });
};

const processInclude = (lat, long, event, currentElement) => {
    let distance = geolib.getDistance(
        { latitude: lat, longitude: long },
        { latitude: currentElement.myLat, longitude: currentElement.myLong }
    );
    if (includesCache.get(getCall(event))) {
        return console.log('Discarding duplicate');
    }
    const direction = geolib.getCompassDirection({ latitude: currentElement.myLat, longitude: currentElement.myLong }, { latitude: lat, longitude: long });
    distance = distance * 0.000621371; //m to mi
    const msg = getMsg('Beacon', currentElement.prefix, distance, direction, event);
    console.log(msg);
    sendPush(currentElement.pushoverUser, currentElement.pushoverToken, msg, (err, res) => {
        if (!err) includesCache.set(getCall(event), new Date().toISOString());
    });

};


const processNearby = (lat, long, event, location, currentElement) => {
    let distance = geolib.getDistance(
        { latitude: lat, longitude: long },
        { latitude: currentElement.myLat, longitude: currentElement.myLong }
    );
    const direction = geolib.getCompassDirection( { latitude: currentElement.myLat, longitude: currentElement.myLong },{ latitude: lat, longitude: long });
    distance = distance * 0.000621371; //m to mi
    if (currentElement.exclude.indexOf(getCall(event)) > -1) {
        console.log(getMsg('Excluded beacon', currentElement.prefix,distance, direction, event));
    } else if (nearbyCache.get(getCall(event))) {
        console.log(getMsg('Duplicate beacon', currentElement.prefix,distance, direction, event));
    } else if (distance < currentElement.reportCloserThanDistanceMiles) {
        const msg = getMsg('Nearby beacon', currentElement.prefix,distance, direction, event);
        console.log(msg);
        sendPush(currentElement.pushoverUser, currentElement.pushoverToken, msg, (err, res) => {
            if (!err) nearbyCache.set(getCall(event), new Date().toISOString());
        });
    } else {
        console.log(getMsg(`Nearby geohash ${location} but not close enough to send a push notification`, currentElement.prefix, distance, direction, event));
    }
};

const processEvent = event => {
    const lat = get('data.latitude', event);
    const long = get('data.longitude', event);
    if (!lat || !long) return;
    const location = ngeohash.encode(lat, long, hashPrecision);
    if (includeObj[event.from.call]) {
        includeObj[event.from.call].forEach((el) => {
            processInclude(lat, long, event, pushUsers.beacons[el]);
        });
    }
    if (includeObj[`${event.from.call}-${event.from.ssid}`]) {
        includeObj[`${event.from.call}-${event.from.ssid}`].forEach((el) => {
            processInclude(lat, long, event, pushUsers.beacons[el]);
        });
    }

    if (typeof geoObj[location] == 'undefined') return;
    geoObj[location].forEach((el) => {
        processNearby(lat, long, event, location,  pushUsers.beacons[el]);
    });
};


const stream = new aprs.APRSISConnector;
stream.connect(pushUsers.myCall);
console.log('Connected to APRS firehose');
stream.on('aprs', processEvent);
