'use strict'
const calls = []
const record = name => async(...args) => { calls.push({ name, args }); return [] }
module.exports = {
  calls,
  createDownloadTasks: record('createDownloadTasks'),
  getDownloadList: record('getDownloadList'),
  pauseDownloadTasks: record('pauseDownloadTasks'),
  resumeSubscriptionPostProcess: record('resumeSubscriptionPostProcess'),
  resumeSubscriptionTaskPostProcess: record('resumeSubscriptionTaskPostProcess'),
  startDownloadTasks: record('startDownloadTasks'),
}
