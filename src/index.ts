export class BasicLogger {
  private static getTimeStamp = (): string => {
    return new Date().toISOString();
  };

  static log(
    method: string,
    statusCode: any | number,
    ip: string | undefined,
    url: string,
    namespace?: string,
    object?: any
  ): void {
    if (object && namespace) {
      console.log(
        `[TIME_STAMP - ${this.getTimeStamp()}] [${namespace}] [LOG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`,
        object
      );
    } else if (!namespace && object) {
        console.log(
            `[TIME_STAMP - ${this.getTimeStamp()}] [LOG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`,
            object
          );
    }
    else if(namespace && !object) {
        console.log(
            `[TIME_STAMP - ${this.getTimeStamp()}] [${namespace}] [LOG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`);
    }
    else {
      console.log(
        `[TIME_STAMP - ${this.getTimeStamp()}] [LOG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`
      );
    }
  }

  static info(message: string, namespace?: string, object?: any): void {
    if (object && namespace) {
      console.info(
        `[TIME_STAMP - ${this.getTimeStamp()}] [${namespace}] [INFO] [${message}]`,
        object
      );
    } else if(namespace && !object) {
        console.info(
            `[TIME_STAMP - ${this.getTimeStamp()}] [${namespace}] [INFO] [${message}]`,
          );
    } else if (object && !namespace) {
        console.info(
            `[TIME_STAMP - ${this.getTimeStamp()}] [INFO] [${message}]`,
            object
          );        
    }
    else {
      console.info(
        `[TIME_STAMP - ${this.getTimeStamp()}] [INFO]  [${message}]`
      );
    }
  }

  static debug(
    method: string,
    ip: string | undefined,
    url: string,
    statusCode: any | number,
    namespace?: string,
    object?: any
  ): void {
    if (object && namespace) {
      console.debug(
        `[TIME_STAMP - ${this.getTimeStamp()}] [${namespace}] [DEBUG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`,
        object
      );
    } else if (object && !namespace) {
        console.debug(
            `[TIME_STAMP - ${this.getTimeStamp()}] [DEBUG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`,
            object
          ); 
    } else if(namespace && !object) {
        console.debug(
            `[TIME_STAMP - ${this.getTimeStamp()}] [${namespace}] [DEBUG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`
          );
    } else {
      console.debug(
        `[TIME_STAMP - ${this.getTimeStamp()}] [DEBUG] [METHOD - ${method}] [STATUS - ${statusCode}] [IP - ${ip}] [URL_CLIENT - ${url}]`
      );
    }
  }

  static error(message: string, namespace: string, object?: any): void {
    if (object && namespace) {
      console.error(
        `[TIME_STAMP - ${this.getTimeStamp()}] [${namespace}] [ERROR] [${message}]`,
        object
      );
    } else if (!namespace && object) {
        console.error(
            `[TIME_STAMP - ${this.getTimeStamp()}][ERROR] [${message}]`,
            object
          );
    } else if (namespace && !object) {
        console.error(
            `[TIME_STAMP - ${this.getTimeStamp()}][ERROR] [${namespace}] [${message}]`
        )
    }
    else {
      console.error(
        `[TIME_STAMP - ${this.getTimeStamp()}] [ERROR]  [${message}]`
      );
    }
  }
}
