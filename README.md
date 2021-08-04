# GoatLogger
Simple logging library

## Install

##### npm

```bash
    $ npm install goatlogger
```
#### yarn
```bash
    $ yarn add goatlogger
```

## How to use

### Directly in controllers or routes handlers
```js
    import { BasicLogger } from 'goatlogger';

    app.get('/foo', (req, res) => {
        BasicLogger.info('foo', { someKey: 'SomeValue' }) // the object is optional
        res.send('from foo)
    })
```

Namespace logging
### Middleware


```js
    import { Request, Response, NextFunction} from 'express';
    import { BasicLogger } from 'goatlogger';

    const loggerMiddleware = ((req: Request, res: Response, next: NextFunction) => {
    /** Log the request */
    const method = request.method;
    const IP = req.socket.remoteAddress;
    const statusCode = res.statusCode;
    const url = req.protocol + '://' + req.get('host') + req.originalUrl;
    response.on('finish', () => {
        BasicLogger.log(method , IP, url);
    });

    next();

    })
    export default loggerMiddleware;
```