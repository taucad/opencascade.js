/** `'100mb'` is a silent emcc misparse today; the `MemorySize` suffix is case-sensitive. */
import { defineBuild } from '@libcascade/toolchain';

export default defineBuild({
  name: 'demo',
  bindings: ['gp_Pnt'],
  settings: {
    // EXPECT-ERROR
    INITIAL_MEMORY: '100mb',
  },
  variants: [{ name: 'single' }],
});
