export class BasicLogger {
    private static  getTimeStamp = (): string => {
        return new Date().toISOString();
    };
   static log(method : string, statusCode: any | number, ip: string | undefined, url: string, object: any): void {
        if (object) {
            console.info(`[TIME_STAMP - ${this.getTimeStamp()}] [TYPE - INFO] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`, object)
        } else {
            console.info(`[TIME_STAMP - ${this.getTimeStamp()}] [TYPE - INFO] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`);
        }
    }
    static info(message: string, object: any): void {
        if (object) {
            console.info(`[TIME_STAMP - ${this.getTimeStamp()}] [INFO] [${message}]`, object)
        } else {
            console.info(`[TIME_STAMP - ${this.getTimeStamp()}] [INFO]  [${message}]`);
        }
    }
}