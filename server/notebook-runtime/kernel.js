let python;
self.onmessage=async ({data})=>{
  try {
    if(data.base){
      importScripts(data.base+'pyodide.js');
      python=await loadPyodide({indexURL:data.base});
      postMessage({ready:true});
      return;
    }
    const outputs=[];
    let remaining=100000;
    const stream=(name,value)=>{
      if(remaining<=0)return;
      const text=(value+'\n').slice(0,remaining);
      remaining-=text.length;
      const last=outputs.at(-1);
      if(last?.name===name)last.text+=text;
      else outputs.push({output_type:'stream',name,text});
    };
    python.setStdout({batched:text=>stream('stdout',text)});
    python.setStderr({batched:text=>stream('stderr',text)});
    try{
      // Jupyter's %pip syntax is handled here for packages built for this kernel.
      const lines=data.source.split('\n');
      for(let i=0;i<lines.length;i++){
        const install=lines[i].trim().match(/^%pip\s+install\s+([\w.-]+(?:\s+[\w.-]+)*)$/);
        if(install){
          await python.loadPackage(install[1].split(/\s+/));
          lines[i]='';
        }
      }
      const source=lines.join('\n');
      await python.loadPackagesFromImports(source);
      const result=await python.runPythonAsync(source);
      if(result!==undefined){
        try{stream('stdout',String(result));}finally{result?.destroy?.();}
      }
      const plots=await python.runPythonAsync(`
def _factx_plots():
    import sys, io, base64
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return []
    images = []
    for index in plt.get_fignums():
        figure = plt.figure(index)
        buffer = io.BytesIO()
        figure.savefig(buffer, format='png')
        images.append(base64.b64encode(buffer.getvalue()).decode('ascii'))
        plt.close(figure)
    return images
_factx_plots()`);
      try{
        for(const image of plots.toJs())outputs.push({output_type:'display_data',metadata:{},data:{'image/png':image}});
      }finally{plots.destroy();}
    }catch(error){stream('stderr',error.message);}
    postMessage({outputs});
  }catch(error){postMessage({error:error.message});}
};
