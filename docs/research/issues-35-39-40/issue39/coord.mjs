const { createInstance } = await import(`libcascade/single/init`);
const oc = await createInstance();
const p = new oc.gp_Pnt(1,2,3);
console.log(JSON.stringify(p.Coord()), JSON.stringify(p.Coord(0,0,0)));
