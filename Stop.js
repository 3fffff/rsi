let shutDownSignal = false;

process
  .on('SIGTERM', shutdown('SIGTERM'))
  .on('SIGINT', shutdown('SIGINT'))
  .on('uncaughtException', shutdown('uncaughtException'));

function shutdown(signal) {
    return (err) => {
        shutDownSignal = true;
        console.log(`Received signal: ${ signal }...`);
        if (err) console.error(err.stack || err);
        setTimeout(() => {
            console.log('...waited 15s, exiting.');
            process.exit(err ? 1 : 0);
        }, 15000).unref();
    };
}

export function getShutDownSingnal() { return shutDownSignal;}
