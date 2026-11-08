const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { dialog } = require('electron');

let chosenBlender;
let busy = false;
async function findBlender(window) {
  const foundation = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Blender Foundation');
  const versions = await fs.readdir(foundation).catch(() => []);
  const candidates = [chosenBlender, ...versions.sort().reverse().map(v => path.join(foundation,v,'blender.exe')),
    'D:/SteamLibrary/steamapps/common/Blender/blender.exe', 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe'];
  for(const file of candidates) if(file && await fs.stat(file).then(s=>s.isFile()).catch(()=>false)) return file;
  const pick = await dialog.showOpenDialog(window,{title:'Выберите установленный blender.exe',properties:['openFile'],filters:[{name:'Blender',extensions:['exe']}]});
  if(pick.canceled)return null;
  if(path.basename(pick.filePaths[0]).toLowerCase()!=='blender.exe')throw Error('Выберите blender.exe.');
  return chosenBlender=pick.filePaths[0];
}
exports.start = async function(window, data) {
  if(busy)throw Error('Уже открыт сеанс Blender.');
  busy=true;
  let folder;
  try {
    const blender=await findBlender(window);
    if(!blender)return null;
    const input=JSON.stringify(data);
    if(input.length>16*1024*1024)throw Error('Фигура слишком велика.');
    folder=await fs.mkdtemp(path.join(os.tmpdir(),'mapstudio-mesh-'));
    const script=path.join(folder,'model.py');
    await fs.copyFile(path.join(__dirname,'model.py'),script);
    await fs.writeFile(path.join(folder,'input.json'),input);
    await new Promise((resolve,reject)=>{
      const child=spawn(blender,['--factory-startup','--disable-autoexec','--python',script,'--',folder],{stdio:'ignore',windowsHide:true});
      child.once('error',reject);
      child.once('exit',code=>code===0?resolve():reject(Error('Blender завершил работу с ошибкой.')));
    });
    const output=path.join(folder,'output.json');
    const info=await fs.stat(output).catch(()=>null);
    if(!info)return null;
    if(info.size>16*1024*1024)throw Error('Сетка превышает 16 МиБ.');
    return JSON.parse(await fs.readFile(output,'utf8'));
  }finally{
    busy=false;
    if(folder) await fs.rm(folder,{recursive:true,force:true}).catch(()=>{});
  }
};
