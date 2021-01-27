"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoatLogger = void 0;
var post_1 = require("./post");
var GoatLogger = /** @class */ (function () {
    function GoatLogger(logOnly, server, token) {
        this.getTimeStamp = function () {
            return new Date().toISOString();
        };
        this.goatServer = 'http://localhost:5000/logger';
        this.logOnly = logOnly;
        this.server = server;
        this.token = token;
    }
    GoatLogger.prototype.info = function (object, namespace, message) {
        if (!this.logOnly) {
            if (object) {
                post_1.postData("[" + this.getTimeStamp() + "] [INFO] [" + namespace + "] " + message, this.server || this.goatServer, 8080);
                console.info("[" + this.getTimeStamp() + "] [INFO] [" + namespace + "] " + message, object);
            }
            else {
                console.info("[" + this.getTimeStamp() + "] [INFO] [" + namespace + "] " + message);
            }
        }
    };
    GoatLogger.prototype.error = function (object, namespace, message) {
        if (object) {
            console.error("[" + this.getTimeStamp() + "] [ERROR] [" + namespace + "] " + message, object);
        }
        else {
            console.error("[" + this.getTimeStamp() + "] [ERROR] [" + namespace + "] " + message);
        }
    };
    return GoatLogger;
}());
exports.GoatLogger = GoatLogger;
