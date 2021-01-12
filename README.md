## APRS Beacon Push Notification

This is a nodejs script that will send you a push notification if someone sends a beacon within X miles of a location.  An account with the "pushover" push notification service is required. https://pushover.net


Rename `config.json.example` to `config.json` and edit it.  Below is the format, commented:

```
{
    "myCall":"XXXXX",                              //Your amateur radio callsign
    "beacons":[ 
        { 
            "myLat": 37.129212,                    //Your latitude
            "myLong": -121.12312,                  //Your longitude
            "reportCloserThanDistanceMiles": 1.0,  //Send a push notification if there are any beacons closer than this many miles 
            "pushoverUser": "XXX",                 //Pushover user key
            "pushoverToken": "XXX",                //Pushover app token
            "exclude": ["XXXXX-10"]                //Exclude these call signs
        }
    ]
}
```

"beacons" is an array, so you can support multiple users/locations.


By default the script will exclude duplicate messages sent within 10 minutes.


Run `npm install` to install dependencies, then `node index.js`.  Run under pm2 or similar for persistence.
