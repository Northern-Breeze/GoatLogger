"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postData = void 0;
var http_1 = __importDefault(require("http"));
var postData = function (data, hostname, port) {
    var options = {
        hostname: hostname,
        post: port,
        method: 'POST',
        header: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    var request = http_1.default.request(options, function (response) {
        console.log("STATUS_CODE", response.statusCode);
        response.on('data', function (d) {
            process.stdout.write(d);
        });
    });
    request.on('error', function (error) {
        console.log(error);
    });
    request.write(data);
    request.end();
};
exports.postData = postData;
