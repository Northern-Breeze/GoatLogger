export declare class BasicLogger {
    private static getTimeStamp;
    static log(method: string, statusCode: any | number, ip: string | undefined, url: string, object: any): void;
    static info(message: string, object: any): void;
}
