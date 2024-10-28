import dns from 'dns'
import { Task, Tasks, ix } from '../..'

class NetworkConnectivityChecker extends ix.Entity {
    ready = false
    task: Task
    constructor() {
        super('internet-checker')
    }
    get unavailable$() {
        this.init()
        return this.rx<void>('ts-basis::internet-checker::unavailable').obs()
    }
    get available$() {
        this.init()
        return this.rx<void>('ts-basis::internet-checker::available').obs()
    }
    init() {
        if (this.ready) {
            return
        }
        this.ready = true
        this.ix.subscribed$.subscribe(e => {
            if (!this.task && e.data.firstTime) {
                this.task = Tasks.addBackground(
                    this,
                    'ts-basis:internet-checker',
                    async () => {
                        // console.log('checking...')
                    },
                    10000,
                )
            }
        })
    }
}

export const connectivityChecker = new NetworkConnectivityChecker()

// require('dns').resolve('www.google.com', function(err) {
//   if (err) {
//      console.log("No connection");
//   } else {
//      console.log("Connected");
//   }
// });
