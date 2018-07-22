var http = require('http');
var fs = require('fs');
var url = require('url');
var qs = require('querystring');
var exec = require('child_process').exec;
var pm2 = require('pm2');

var serverSettings = {
    manager: {},
    net64: {}
};

function writeDebug(message) {
    console.log(message);
}

function readFile(path, options) {
    writeDebug('Reading File: ' + path);
    return new Promise(function(resolve, reject){
        fs.readFile(path, options, (err, data) => err ? reject(err) : resolve(data));
    });
}

function writeFile(path, data) {
    writeDebug('Writing File: ' + path);
    return new Promise(function(resolve, reject){
        fs.writeFile(path, data, (err) => err ? reject(err) : resolve(data));
    })
}

function updateServerSettings(server, settings) {
    writeDebug('Updating Server Settings: ' + server);
    return new Promise(function(resolve, reject){
        if(settings) {
            serverSettings[server] = settings;
            resolve(settings);
        } else {
            reject('Settings Not Update - No Value Provided');
        }
    });
}

function readHttpStreamBody(stream) {
    writeDebug('Reading HTTP Stream Body');
    return new Promise(function(resolve, reject){
        let body = '';

        stream.on('data', chunk => body += chunk);
        stream.on('end', () => resolve(body));
    });
}

function loadManagerSettings() {
    writeDebug('Loading Manager Settings');
    return new Promise(function(resolve, reject){
        http.get({host: 'ip-api.com', path: '/json'}, function(response){
            readHttpStreamBody(response)
                .then(
                    body => body.length ? resolve({publicIp: JSON.parse(body).query}) : reject('No Data Returned'),
                    err => reject('Lookup Service Failed')
                );
        })
    });
}

function cacheManagerSettings(settings) {
    writeDebug('Caching Manager Settings');
    updateServerSettings('manager', settings);
}

function loadOverrideNet64Settings() {
    writeDebug('Loading Override Net64 Settings');
    return readFile('/usr/src/overrides/settings.json');
}

function loadDefaultNet64Settings() {
    writeDebug('Loading Default Net64 Settings');
    return readFile('/usr/src/net64plus-server-master/settings.json');
}

function saveNet64Settings(settings) {
    writeDebug('Saving Net64 Settings: ' + settings);
    return writeFile('/usr/src/net64plus-server-master/settings.json', settings);
}

function cacheNet64Settings(settings) {
    writeDebug('Caching Net 64 Settings');
    return updateServerSettings('net64', settings);
}

function startNet64Server() {
    writeDebug('Staring Net64 Server');
    return new Promise(function(resolve, reject){
        exec('pm2 start /usr/src/net64plus-server-master/dist --name="net64"', err => err ? reject(err) : resolve());
    });
}

function restartNet64Server() {
    writeDebug('Staring Net64 Server');
    return new Promise(function(resolve, reject){
        exec('pm2 restart "net64"', err => err ? reject(err) : resolve());
    });
}

const responseTypes = {
    HTML: 0,
    CSS: 1,
    JS: 2
}

function startRequest(request, response) {
    writeDebug('');
    writeDebug('Starting Request');
    return new Promise(function(resolve, reject){
        const context = {
            request: {
                request: request,
                pathname: url.parse(request.url, true).pathname,
                body: ''
            },
            response: {
                response: response
            }
        }

        switch (context.request.pathname.split('?')[0].split('.').slice(-1)[0]) {
            case 'css':
                context.response.responseType = responseTypes.CSS;
                break;
            case 'js':
                context.response.responseType = responseTypes.JS;
                break;
            default:
                context.response.responseType = responseTypes.HTML;
                break;
        }

        readHttpStreamBody(context.request.request)
            .then(
                body => {
                    body.length ? context.request.body = qs.parse(body) : undefined;
                    resolve(context);
                },
                err => {
                    // Doesn't matter if there's an error here, we can continue as normal
                    resolve(context);
                }
            );
    });
}

function saveUserSettings(settings) {
    writeDebug('Saving User Settings');
    return new Promise(function(resolve, reject){
        if(settings) {
            // Convert from string to boolean
            settings.enableWebHook = (settings.enableWebHook === 'true');
            // Add port to new settings
            settings.port = serverSettings.net64.port;
            cacheNet64Settings(settings)
                .then(results => JSON.stringify(results))
                .then(saveNet64Settings)
                .then(restartNet64Server)
                .then(() => resolve(), (err) => reject(err));
        } else {
            resolve();
        }
    });
}

function processRequest(context) {
    writeDebug('Processing Request');
    return new Promise(function(resolve, reject){
        saveUserSettings(context.request.body)
            .then(
                () => resolve(context),
                err => {
                    writeDebug(err);
                    // It's ok if it fails here, we can still serve static content
                    resolve(context);
                }
        );
    })
}

function getSettingsForm() {
    writeDebug('Getting Settings Form');
    return new Promise(function(resolve, reject){
        readFile('/usr/src/settings/dist/settings.html', 'utf8')
            .then(content => Object.keys(serverSettings.manager).reduce((acc, val) => acc.replace('${' + val + '}', serverSettings.manager[val]), content))
            .then(content => Object.keys(serverSettings.net64).reduce((acc, val) => typeof serverSettings.net64[val] === 'boolean' ? acc.replace('${' + val + ':true}', (serverSettings.net64[val] ? 'selected' : '')).replace('${' + val + ':false}', (serverSettings.net64[val] ? '' : 'selected')) : acc.replace('${' + val + '}', serverSettings.net64[val]), content))
            .then(content => resolve(content), err => reject(err));
    });
}

function createResponse(context) {
    writeDebug('Creating Response');
    return new Promise(function(resolve, reject){
        let contentPromise;

        switch(context.response.responseType){
            case responseTypes.CSS:
                context.response.headers = {'Content-Type': 'text/css'}
                contentPromise = readFile('/usr/src/settings/dist' + context.request.pathname);
                break;
            case responseTypes.JS:
                context.response.headers = {'Content-Type': 'application/json'}
                contentPromise = readFile('/usr/src/settings/dist' + context.request.pathname);
                break;
            default:
                context.response.headers = {
                    'Content-Type': 'text/html',
                    'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                    'Expires': '-1',
                    'Pragma': 'no-cache'
                };
                contentPromise = getSettingsForm();
                break;
        }

        contentPromise.then(
            content => {
                context.response.content = content;
                resolve(context);
            },
            // Errors are bad here, let's bubble them up
            err => reject(err)
        );
    });
}

function endRequest(context) {
    writeDebug('Ending Request');
    return new Promise(function(resolve, reject){
        context.response.response.writeHead(200, context.response.headers);
        context.response.response.write(context.response.content);
        context.response.response.end();
    });
}

function startSettingsServer() {
    writeDebug('Starting Settings Server');
    return new Promise(function(resolve, reject){
        http.createServer(function(request, response) {
            startRequest(request, response)
                .then(processRequest)
                .then(createResponse)
                .then(endRequest)
                .catch(err => {
                    context.response.response.writeHead(500, {
                        'Content-Type': 'text/html',
                        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                        'Expires': '-1',
                        'Pragma': 'no-cache'
                    });
                    context.response.response.write('<!DOCTYPE html><html><body><h1>An Error Has Occurred</h1><p>' + err + '</p></body></html>');
                    context.response.response.end();
                });
        }).listen(8080);

        resolve();
    })
}

function logPassiveError(error) {
    return new Promise(function(resolve, reject) {
        writeDebug('Passive Error: ' + error);
        resolve();
    });
}

function logAggressiveError(error) {
    writeDebug('Passive Error: ' + error);
}

loadManagerSettings()
    .then(cacheManagerSettings)
    .catch(logPassiveError)
    .then(loadOverrideNet64Settings)
    .then(saveNet64Settings, loadDefaultNet64Settings)
    .then(result => JSON.parse(result))
    .then(cacheNet64Settings)
    .then(startNet64Server)
    .then(startSettingsServer)
    .catch(logAggressiveError);

var test = '┌──────────┬────┬──────┬─────┬────────┬─────────┬────────┬─────┬───────────┬──────┬──────────┐│ App name │ id │ mode │ pid │ status │ restart │ uptime │ cpu │ mem       │ user │ watching │├──────────┼────┼──────┼─────┼────────┼─────────┼────────┼─────┼───────────┼──────┼──────────┤│ net64    │ 0  │ fork │ 43  │ online │ 0       │ 42m    │ 0%  │ 44.8 MB   │ root │ disabled │└──────────┴────┴──────┴─────┴────────┴─────────┴────────┴─────┴───────────┴──────┴──────────┘';

function parsePm2Listing(listing) {
    let elements = listing.split(String.fromCharCode(9474)).splice(1);
    elements.pop();
    const columnCount = Math.floor(elements.length / 2);
    let results = {};

    for(let index = 0; index < columnCount; ++index) {
        results[elements[index].trim().toLowerCase().replace(/ /g, '_')] = elements[index + columnCount + 1].trim();
    }

    return elements;
}