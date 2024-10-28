import * as yaml from 'js-yaml'
import { DESTOR, DestorUrlEntry } from './env.destor'
import { Upstream } from '../../upstream'
import { UpstreamHttpDatastore } from '../../upstream/upstream-http-connector'

export interface TopologyConfig {
    destor: DestorUrlEntry[]
    primaryDatastore?: {
        profile?: string | 'test'
        domain?: string | 'local'
        type?: string | 'http'
        endpoint: string
        credentials?: { authHeaders?: { [name: string]: string } }
    }
    datastores?: {
        [appProfile: string]: {
            [domain: string]: {
                type: string | 'http'
                endpoint: string
                credentials?: { authHeaders?: { [name: string]: string } }
            }
        }
    }
}

export function loadTopologyConfig(content: string, onlyGetConfig = false) {
    let config: TopologyConfig
    try {
        config = JSON.parse(content)
    } catch (e) {
        config = yaml.load(content) as TopologyConfig
    }
    const effectuate = !onlyGetConfig
    if (config.destor && config.destor.length) {
        if (effectuate) {
            DESTOR.LIST = config.destor
        }
    }
    if (config.primaryDatastore) {
        if (!config.primaryDatastore.profile) {
            config.primaryDatastore.profile = 'test'
        }
        if (!config.primaryDatastore.domain) {
            config.primaryDatastore.domain = 'local'
        }
        if (!config.primaryDatastore.type) {
            config.primaryDatastore.type = 'http'
        }
        if (effectuate) {
            Upstream.constructMultiverse({
                [config.primaryDatastore.profile]: {
                    [config.primaryDatastore.domain]: Upstream.add(
                        new UpstreamHttpDatastore({
                            path: config.primaryDatastore.domain,
                            endpoint: {
                                type: config.primaryDatastore.type,
                                endpoint: config.primaryDatastore.endpoint,
                                credentials: config.primaryDatastore.credentials
                                    ? config.primaryDatastore.credentials
                                    : { authHeaders: {} },
                            },
                        }),
                    ),
                },
            })
        }
    }
    return config
}
