import { postData } from './post';

export class GoatLogger {
    private readonly getTimeStamp = (): string => {
        return new Date().toISOString();
    };
    private readonly goatServer: string = 'http://localhost:5000/logger';
    logOnly: boolean;
    server: string;
    token: string;
    constructor(logOnly: boolean, server: string, token: string){
        this.logOnly = logOnly;
        this.server = server;
        this.token = token;
    }
    info(object: any, namespace: string, message: string): void{
        if(!this.logOnly){
            if (object) {
                postData(`[${this.getTimeStamp()}] [INFO] [${namespace}] ${message}`, this.server || this.goatServer, 8080)
                console.info(`[${this.getTimeStamp()}] [INFO] [${namespace}] ${message}`, object);
            } else {
                console.info(`[${this.getTimeStamp()}] [INFO] [${namespace}] ${message}`);
            }
        }
    }
    error(object: any, namespace: string, message: string): void {
        if (object) {
            console.error(`[${this.getTimeStamp()}] [ERROR] [${namespace}] ${message}`, object);
        } else {
            console.error(`[${this.getTimeStamp()}] [ERROR] [${namespace}] ${message}`);
        }
    }
}

export class BasicLogger {
    private static  getTimeStamp = (): string => {
        return new Date().toISOString();
    };
   static info(object: any, namespace: string, message: string): void {
        if (object) {
            console.info(`[${this.getTimeStamp()}] [INFO] [${namespace}] ${message}`, object);
        } else {
            console.info(`[${this.getTimeStamp()}] [INFO] [${namespace}] ${message}`);
        }
    }
    static error(object: any, namespace: string, message: string): void {
        if (object) {
            console.error(`[${this.getTimeStamp()}] [ERROR] [${namespace}] ${message}`, object);
        } else {
            console.error(`[${this.getTimeStamp()}] [ERROR] [${namespace}] ${message}`);
        }
    }
}