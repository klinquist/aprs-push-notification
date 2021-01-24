const licenseCacheDays = 14;
const aprs = require('aprs-parser');
const Push = require('pushover-notifications');
const ngeohash = require('ngeohash');
const geolib = require('geolib');
const NodeCache = require('node-cache');
const moment = require('moment-timezone');
const request = require('request');


const get = (p, o) => {
    if (!Array.isArray(p)) p = p.split('.');
    return p.reduce((xs, x) => (xs && xs[x]) ? xs[x] : null, o);
};

let configFile;
try {
    configFile = JSON.parse(require('fs').readFileSync('./config.json'));
} catch (e) {
    console.log('Unable to read config.json');
    process.exit(1);
}


const nearbyDedupeMinutes = configFile.nearbyDedupeMinutes || 60;
const includesDedupeMinutes = configFile.includesDedupeMinutes || 240;
const hashPrecision = configFile.hashPrecision || 3;

const nearbyCache = new NodeCache({ stdTTL: nearbyDedupeMinutes * 60 });
const includesCache = new NodeCache({ stdTTL: includesDedupeMinutes * 60 });
const licenseCache = new NodeCache({ stdTTL: licenseCacheDays*60*1440});



const geoObj = {};
const includeObj = {};

console.log('Building geohash & include cache...');
Object.keys(configFile.beacons).forEach((el) => {
    const hash = ngeohash.encode(configFile.beacons[el].myLat, configFile.beacons[el].myLong, hashPrecision);
    console.log(`Assigning hash "${hash}" to key ${el}`);
    if (typeof geoObj[hash] == 'undefined') geoObj[hash] = [];
    configFile.beacons[el].prefix = el;
    geoObj[hash].push(el);
    if (configFile.beacons[el].include) {
        for (let p = 0; p < configFile.beacons[el].include.length; p++){
            console.log(`Assigning include "${configFile.beacons[el].include[p]}" to key ${el}`);
            if (typeof includeObj[configFile.beacons[el].include[p]] == 'undefined') includeObj[configFile.beacons[el].include[p]] = [];
            includeObj[configFile.beacons[el].include[p]].push(el);
        }
    }
});


const metersToMiles = (dist) => {
    return dist* 0.000621371;
};


const titleCase = (string) => {
    var sentence = string.toLowerCase().split(' ');
    for(var i = 0; i< sentence.length; i++){
        sentence[i] = sentence[i][0].toUpperCase() + sentence[i].slice(1).toLowerCase();
    }
    return sentence.join(' ');
};


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
    return (Math.round(distance * 10) / 10).toString() + ' mi';
};

const getPrefix = pfx => {
    return `(${pfx})`;
};

const getTime = (tz) => {
    if (!tz) tz = 'America/Los_Angeles';
    return moment().tz(tz).format('MMM Do h:mm:ss A z');
};

const getDirection = (direction) => {
    return direction || '';
};

const getLink = (event) => {
    let call;
    if (event.from.ssid) {
        call= event.from.call + '-' + event.from.ssid;
    } else {
        call= event.from.call;
    }
    return `https://aprs.fi/#!call=a%2F${call}`;
};


const formatAPIResponse = (lic) => {
    if (!lic.name) return ('Unknown license');
    if (lic.current && lic.current.operClass) {
        return titleCase(lic.name) + ' (' + lic.current.operClass + ')';
    } else {
        return titleCase(lic.name);
    }
};

const getNameFromAPI = (event, cb) => {
    if (!event.from || !event.from.call) return cb(null, '');
    const lc = licenseCache.get(event.from.call);
    if (lc) return cb(null, lc);
    const url = `http://callook.info/index.php?callsign=${event.from.call}&display=json`;
    request({ method: 'GET', uri: url, json: true }, (err, res, data) => {
        if (err) {
            return cb(null, 'Unknown license');
        } else {
            const fmt = formatAPIResponse(data);
            licenseCache.set(event.from.call, fmt);
            return cb(null, fmt);
        }
    });
};

const getLicenseString = (lic) => {
    if (!lic) return '';
    return ' - ' + lic;
};

const getMsg = (opts) => {
    const { msg, pfx, distance, direction, event, license, tz} = opts;
    let rtn = [
        getTime(tz),
        ':',
        getPrefix(pfx),
        msg,
        getCall(event),
        'is',
        getRoundedDistance(distance),
        getDirection(direction),
        getRadio(event),
        getComment(event),
        getLicenseString(license)
    ];
    rtn = rtn.join(' ');
    rtn = rtn.replace(/\s\s+/g, ' '); //Get rid of extra spaces
    return rtn;
};


const sendPush = (opts, cb) => {
    const { user, token, msg, url} = opts;
    const push = new Push({ user, token });
    push.send({
        message: msg,
        priority: 1,
        url,
        url_title: 'aprs.fi'
    }, (err) => {
        if (err) console.log('Error sending push notification: ' + err);
        return cb(err);
    });
};

const processInclude = (opts) => {
    const { lat, long, event, currentElement} = opts;
    const distance = metersToMiles(geolib.getDistance(
        { latitude: lat, longitude: long },
        { latitude: currentElement.myLat, longitude: currentElement.myLong }
    ));
    const direction = geolib.getCompassDirection({ latitude: currentElement.myLat, longitude: currentElement.myLong }, { latitude: lat, longitude: long });
    if (includesCache.get(getCall(event))) {
        return console.log(getMsg({ msg: 'Duplicate beacon', pfx: currentElement.prefix, distance, direction, event, tz: currentElement.timezone }));
    }

    getNameFromAPI(event, (err, res) => {
        const msg = getMsg({ msg: 'Beacon', pfx: currentElement.prefix, distance, direction, event, tz: currentElement.timezone });
        console.log(msg);
        sendPush({ user: currentElement.pushoverUser, token: currentElement.pushoverToken, msg, license: res, url: getLink(event) }, (err, res) => {
            if (err) {
                console.log('Error sending push notification! ' + err);
            } else {
                includesCache.set(getCall(event), new Date().toISOString());
            }
        });
    });


};


const processNearby = (opts) => {
    const { lat, long, event, location, currentElement} = opts;
    const distance = metersToMiles(geolib.getDistance(
        { latitude: lat, longitude: long },
        { latitude: currentElement.myLat, longitude: currentElement.myLong }
    ));
    const direction = geolib.getCompassDirection( { latitude: currentElement.myLat, longitude: currentElement.myLong },{ latitude: lat, longitude: long });
    if (currentElement.exclude.indexOf(getCall(event)) > -1) {
        console.log(getMsg({ msg: 'Excluded beacon', pfx: currentElement.prefix, distance, direction, event,tz: currentElement.timezone }));
    } else if (nearbyCache.get(getCall(event))) {
        console.log(getMsg({ msg: 'Duplicate beacon', pfx: currentElement.prefix, distance, direction, event,tz: currentElement.timezone }));
    } else if (distance < currentElement.reportCloserThanDistanceMiles) {
        getNameFromAPI(event, (err, res) => {
            const msg = getMsg({ msg: 'Nearby beacon', pfx: currentElement.prefix, distance, direction, event, license: res,tz: currentElement.timezone });
            console.log(msg);
            sendPush({ user: currentElement.pushoverUser, token: currentElement.pushoverToken, msg, url: getLink(event) }, (err, res) => {
                if (err) {
                    console.log('Error sending push notification! ' + err);
                } else {
                    nearbyCache.set(getCall(event), new Date().toISOString());
                }
            });
        });
    } else {
        console.log(getMsg({ msg: `Nearby geohash ${location} but not close enough to send a push notification`, pfx: currentElement.prefix, distance, direction, event, tz: currentElement.timezone } ));
    }
};



const processEvent = event => {
    const lat = get('data.latitude', event);
    const long = get('data.longitude', event);
    if (!lat || !long) return;
    const location = ngeohash.encode(lat, long, hashPrecision);
    if (includeObj[event.from.call]) {
        includeObj[event.from.call].forEach((el) => {
            processInclude({ lat, long, event, currentElement: configFile.beacons[el] });
        });
    }
    if (includeObj[`${event.from.call}-${event.from.ssid}`]) {
        includeObj[`${event.from.call}-${event.from.ssid}`].forEach((el) => {
            processInclude({ lat, long, event, currentElement: configFile.beacons[el] });
        });
    }

    if (typeof geoObj[location] == 'undefined') return;
    geoObj[location].forEach((el) => {
        processNearby({ lat, long, event, location, currentElement: configFile.beacons[el] });
    });
};


const stream = new aprs.APRSISConnector;
stream.connect(configFile.myCall);
console.log('Connected to APRS firehose');
stream.on('aprs', processEvent);
