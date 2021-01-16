## APRS Beacon Push Notification

This is a nodejs script that will send you a push notification:
* If a defined list of callsigns sends a beacon
* If any beacons are received within X miles of a location.  


An account with the "pushover" push notification service is required. https://pushover.net


Rename `config.json.example` to `config.json` and edit it.  Below is the format, commented:

```
{
    "myCall":"XXXXX",                              //Your amateur radio callsign
    "beacons": {
        "myHouse": {                               //Name your location here. This will be a prefix on your text messages!
            "myLat": 37.129212,                    //Your latitude
            "myLong": -121.12312,                  //Your longitude
            "reportCloserThanDistanceMiles": 1.0,  //Send a push notification if there are any beacons closer than this many miles 
            "pushoverUser": "XXX",                 //Pushover user key
            "pushoverToken": "XXX",                //Pushover app token
            "exclude": ["XXXXX-10"]                //Exclude these call signs from location-based push notifications
            "include": ["XXXXX", "XXXXX-2"]        //Always receive push notifications of beacons from these calls regardless of location
        }
    }
}
```

"beacons" is an object, so you can support multiple users/locations by creating additional named objects


By default the script will exclude duplicate location-based messages sent within 10 minutes and exclude duplicate "include" messages sent within 30 minutes.


Run `npm install` to install dependencies, then `node index.js`.  Run under pm2 or similar for persistence.


#### Design

I [geohash](https://en.wikipedia.org/wiki/Geohash) the lat/longs in the config file along with every incoming message, then perform a distance calculation on beacons that match the geohash. This method is faster than calculating the distance for every incoming message (over twice as fast!), resulting in less CPU usage.   The APRS firehose can receive 250+ messages per second.


### Don't have a pi or other "server" to run this on?

Contact me and I'll be happy to add your location to my instance running 24/7.





