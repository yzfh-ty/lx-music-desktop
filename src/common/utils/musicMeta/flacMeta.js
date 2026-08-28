const fs = require('fs')
const fsPromises = fs.promises
const path = require('path')
const getImgSize = require('image-size')
const download = require('./downloader')

const FlacProcessor = require('./flac-metadata/index')

const extReg = /^(\.(?:jpe?g|png)).*$/
const vendor = 'reference libFLAC 1.2.1 20070917'

const writeMeta = async(filePath, meta, picPath) => {
  const comments = Object.keys(meta).map(key => `${key.toUpperCase()}=${meta[key] || ''}`)
  const data = {
    vorbis: {
      vendor,
      comments,
    },
  }
  if (picPath) {
    const apicData = await fsPromises.readFile(picPath)
    let imgSize = getImgSize(apicData)
    let mime_type
    let bitsPerPixel
    if (apicData[0] == 0xff && apicData[1] == 0xd8 && apicData[2] == 0xff) {
      mime_type = 'image/jpeg'
      bitsPerPixel = 24
    } else {
      mime_type = 'image/png'
      bitsPerPixel = 32
    }
    data.picture = {
      pictureType: 3,
      mimeType: mime_type,
      description: '',
      width: imgSize.width,
      height: imgSize.height,
      bitsPerPixel,
      colors: 0,
      pictureData: apicData,
    }
  }

  await new Promise((resolve, reject) => {
    const reader = fs.createReadStream(filePath)
    const tempPath = filePath + '.lxmtemp'
    const writer = fs.createWriteStream(tempPath)
    const flacProcessor = new FlacProcessor()
    flacProcessor.writeMeta(data)
    const onError = err => reject(err)
    reader.on('error', onError)
    writer.on('error', onError)
    flacProcessor.on('error', onError)
    reader.pipe(flacProcessor).pipe(writer).on('finish', () => {
      fs.unlink(filePath, err => {
        if (err) return reject(err)
        fs.rename(tempPath, filePath, err => err ? reject(err) : resolve())
      })
    })
  })
}

module.exports = (filePath, meta, proxy) => {
  if (!meta.APIC) return writeMeta(filePath, meta)
  let picUrl = meta.APIC
  delete meta.APIC
  if (!/^http/.test(picUrl)) {
    return writeMeta(filePath, meta, picUrl)
  }
  let ext = path.extname(picUrl)
  let picPath = filePath.replace(/\.flac$/, '') + (ext ? ext.replace(extReg, '$1') : '.jpg')

  if (picUrl.includes('music.126.net')) picUrl += `${picUrl.includes('?') ? '&' : '?'}param=500y500`
  return download(picUrl, picPath, proxy).then(success => {
    if (success) {
      return writeMeta(filePath, meta, picPath).finally(() => {
        fs.unlink(picPath, err => {
          if (err) console.log(err.message)
        })
      })
    }
    return writeMeta(filePath, meta)
  })
}

