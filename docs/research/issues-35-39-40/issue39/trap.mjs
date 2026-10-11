const variant = process.argv[2] || 'single';
const { createInstance } = await import(`libcascade/${variant}/init`);
const oc = await createInstance();
let s = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0,0,0), new oc.gp_Pnt(1,2,3)).Shape();
s = new oc.BRepBuilderAPI_NurbsConvert(s, false).Shape();
new oc.BRepMesh_IncrementalMesh(s, 0.1, false, 0.5, false);
try { new oc.BRepBuilderAPI_NurbsConvert(s, false); } catch (e) { console.log(e.stack); }
