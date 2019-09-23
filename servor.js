#!/usr/bin/env node

const fs = require('fs');
const url = require('url');
const path = require('path');
const http = require('https');

// ----------------------------------
// Generate map of all known mimetypes
// ----------------------------------

const mime = Object.entries(require('./types.json')).reduce(
  (all, [type, exts]) =>
    Object.assign(all, ...exts.map(ext => ({ [ext]: type }))),
  {}
);

// ----------------------------------
// Parse arguments from the command line
// ----------------------------------

const args = process.argv.slice(2).filter(x => !~x.indexOf('--'));

const root = args[0] || '.';
const fallback = args[1] || 'index.html';
const port = args[2] || 8080;
const reloadPort = args[3] || 5000;

const browser = !~process.argv.indexOf('--no-browser');
const reload = !~process.argv.indexOf('--no-reload');

const cwd = process.cwd();

const ssl = {
  cert: fs.readFileSync('servor.crt'),
  key: fs.readFileSync('servor.key')
};

// ----------------------------------
// Template clientside reload script
// ----------------------------------

const reloadScript = `
  <script>
    const source = new EventSource('https://'+location.hostname+':${reloadPort}');
    source.onmessage = e => location.reload(true);
  </script>
`;

// ----------------------------------
// Server utility functions
// ----------------------------------

const sendError = (res, resource, status) => {
  res.writeHead(status);
  res.end();
  console.log(' \x1b[41m', status, '\x1b[0m', `${resource}`);
};

const sendFile = (res, resource, status, file, ext) => {
  res.writeHead(status, {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(file, 'binary');
  res.end();
  console.log(' \x1b[42m', status, '\x1b[0m', `${resource}`);
};

const sendMessage = (res, channel, data) => {
  res.write(`event: ${channel}\nid: 0\ndata: ${data}\n`);
  res.write('\n\n');
};

const isRouteRequest = uri =>
  uri
    .split('/')
    .pop()
    .indexOf('.') === -1
    ? true
    : false;

// ----------------------------------
// Start file watching server
// ----------------------------------

let fileWatchers = [];

reload &&
  http
    .createServer(ssl, (request, res) => {
      // Open the event stream for live reload
      res.writeHead(200, {
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      // Send an initial ack event to stop any network request pending
      sendMessage(res, 'connected', 'ready');
      // Send a ping event every minute to prevent console errors
      setInterval(sendMessage, 60000, res, 'ping', 'waiting');
      // Register connection to be notified of file changes
      fileWatchers.push(res);
    })
    .listen(parseInt(reloadPort, 10));

// Watch the target directory for changes and trigger reloads
fs.watch(path.join(cwd, root), { recursive: true }, () => {
  while (fileWatchers.length > 0)
    sendMessage(fileWatchers.pop(), 'message', 'reloading');
});

// ----------------------------------
// Start static file server
// ----------------------------------

http
  .createServer(ssl, (req, res) => {
    const pathname = url.parse(req.url).pathname;
    const isRoute = isRouteRequest(pathname);
    const status = isRoute && pathname !== '/' ? 301 : 200;
    const resource = isRoute ? `/${fallback}` : decodeURI(pathname);
    const uri = path.join(cwd, root, resource);
    const ext = uri.replace(/^.*[\.\/\\]/, '').toLowerCase();
    isRoute && console.log('\n \x1b[44m', 'RELOADING', '\x1b[0m\n');
    // Check if files exists at the location
    fs.stat(uri, (err, stat) => {
      if (err) return sendError(res, resource, 404);
      // Respond with the contents of the file
      fs.readFile(uri, 'binary', (err, file) => {
        if (err) return sendError(res, resource, 500);
        if (isRoute && reload) file += reloadScript;
        sendFile(res, resource, status, file, ext);
      });
    });
  })
  .listen(parseInt(port, 10));

// ----------------------------------
// Get available IP addresses
// ----------------------------------
const interfaces = require('os').networkInterfaces();
const ips = Object.values(interfaces)
  .reduce((a, b) => [...a, ...b], [])
  .filter(ip => ip.family === 'IPv4' && ip.internal === false)
  .map(ip => `https://${ip.address}:${port}`);

// ----------------------------------
// Log startup details to terminal
// ----------------------------------

console.log(`\n 🗂  Serving files from ./${root} on https://localhost:${port}`);
ips.length > 0 && console.log(` 📡 Exposed to the network on ${ips[0]}`);
console.log(` 🖥  Using ${fallback} as the fallback for route requests`);
console.log(` ♻️  Reloading the browser when files under ./${root} change`);

// ----------------------------------
// Open the page in the default browser
// ----------------------------------

const page = `https://localhost:${port}`;
const open =
  process.platform == 'darwin'
    ? 'open'
    : process.platform == 'win32'
    ? 'start'
    : 'xdg-open';

browser && require('child_process').exec(open + ' ' + page);
