'use strict'
const calls = []
const record = name => async(...args) => { calls.push({ name, args }); return [] }
let getDownloadListBehaviour = async() => []
module.exports = {
  calls,
  reset() { calls.length = 0; getDownloadListBehaviour = async() => [] },
  setGetDownloadListBehaviour(behaviour) { getDownloadListBehaviour = behaviour },
  createDownloadTasks: record('createDownloadTasks'),
  getDownloadList: async(...args) => { calls.push({ name: 'getDownloadList', args }); return getDownloadListBehaviour(...args) },
  pauseDownloadTasks: record('pauseDownloadTasks'),
  resumeSubscriptionPostProcess: record('resumeSubscriptionPostProcess'),
  resumeSubscriptionTaskPostProcess: record('resumeSubscriptionTaskPostProcess'),
  startDownloadTasks: record('startDownloadTasks'),
}
