/*
 * Copyright 2014-2021 Justin Pauli, all rights reserved.
 */

import { AsyncActionHandlers } from '../proc/async.worker.proc'

export const asyncWorkerExtensionSample: AsyncActionHandlers = {
    sampleAction: (payload, worker) => {
        return 'Hello World!'
    },
}
