export declare class GoatLogger {
    private readonly getTimeStamp;
    private readonly goatServer;
    logOnly: boolean;
    server: string;
    token: string;
    constructor(logOnly: boolean, server: string, token: string);
    info(object: any, namespace: string, message: string): void;
    error(object: any, namespace: string, message: string): void;
}
