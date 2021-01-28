# GoatLogger
Simple logging library

## Install
> npm
```bash
    $ npm install goatlogger
```
> yarn
```bash
    $ yarn add goatlogger
```

## How to use
```js
    const { BasicLogger } = require('goatlogger');
        ...
    app.use((req, res, next) => {
    /** Log the request */
    BasicLogger.log(req.method, 0, req.socket.remoteAddress , req.protocol + '://' + req.get('host') + req.originalUrl, {});
    response.on('finish', () => {
        /** Log the response */
        BasicLogger.log(request.method, res.statusCode, req.socket.remoteAddress , req.protocol + '://' + req.get('host') + req.originalUrl, {});
    });
    next();
    })
```

## How to use es module
log request response middleware
```js
    import { BasicLogger } from 'goatlogger';
    ...
    app.use((req, res, next) => {
    /** Log the request */
    BasicLogger.log(req.method, 0, req.socket.remoteAddress , req.protocol + '://' + req.get('host') + req.originalUrl, {});
    response.on('finish', () => {
        /** Log the response */
        BasicLogger.log(request.method, res.statusCode, req.socket.remoteAddress , req.protocol + '://' + req.get('host') + req.originalUrl, {});
    });
    next();
    })
```