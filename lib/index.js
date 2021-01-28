"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasicLogger = void 0;
var BasicLogger = /** @class */ (function () {
    function BasicLogger() {
    }
    BasicLogger.log = function (method, statusCode, ip, url, object) {
        if (object) {
            console.info("[TIME_STAMP - " + this.getTimeStamp() + "] [TYPE - INFO] [METHOD - " + method + "] [STATUS - " + statusCode + "] [IP - " + ip + "] [URL_CLIENT - " + url + "]", object);
        }
        else {
            console.info("[TIME_STAMP - " + this.getTimeStamp() + "] [TYPE - INFO] [METHOD - " + method + "] [STATUS - " + statusCode + "] [IP - " + ip + "] [URL_CLIENT - " + url + "]");
        }
    };
    BasicLogger.info = function (message, object) {
        if (object) {
            console.info("[TIME_STAMP - " + this.getTimeStamp() + "] [INFO] [" + message + "]", object);
        }
        else {
            console.info("[TIME_STAMP - " + this.getTimeStamp() + "] [INFO]  [" + message + "]");
        }
    };
    BasicLogger.getTimeStamp = function () {
        return new Date().toISOString();
    };
    return BasicLogger;
}());
exports.BasicLogger = BasicLogger;
