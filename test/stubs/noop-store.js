'use strict'
// songList / leaderboard action：本测试不涉及歌单同步
const notUsed = name => async() => { throw new Error(`测试桩未实现：${name}`) }
module.exports = {
  getListDetailAll: notUsed('getListDetailAll'),
}
