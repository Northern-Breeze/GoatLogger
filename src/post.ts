import http from 'http';

export const postData = (data: any, hostname: string, port: number) => {
    const options = {
        hostname: hostname,
        post: port,
        method: 'POST',
        header: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    const request = http.request(options, (response: any): void => {
        console.log(`STATUS_CODE`, response.statusCode);
        response.on('data', (d: any): void => {
            process.stdout.write(d);
        })
    })
    request.on('error', (error: any): void => {
        console.log(error);
    })
    request.write(data);
    request.end();
}