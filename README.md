# rosetta

This is a half-baked idea to run webpack loaders as more generic build-time transpilers,
isolated from webpack itself. Instead of packing evrything into a bundle, or even parsing
source files to look for `require`s, this simply scans every file in specified source directories
and transforms the contents of each file through specified loaders (based on file matching
conditions, similar to webpack config) to generate output files. More like babel, but not
limited to Javascript input (or output, for that matter). For instance, you can precompile
your handlebars files into javascript modules that export a function that renders the template
with the given inputs (with the `handlebars-loader`). Or you can transcribe a YAML file
into a JSON file (with the `yaml-loader`), which can in turn be transcribed into a true
Javascript file that exports the object (with the `json-loader`).

## Left Off Here

This is more complex than I'd like it to be, really just because the webpack loader
"spec" is pretty complex and not very well documented, at least as of now. I scratched
together a quick proof of concept (`old_main.js`), and then attempted to refactor it a
bit, which is what you're looking at now. However, I never really put much effort into
coming up with a coherent architecture, or understanding the webpack spec as a whole.

I've basically just started introducing some source files in the `demo/` directory
with a demo configuration that processes them through a handful of loaders. Currently,
`yaml-loader`, `json-loader`, `babel-loader`, and `handlebars-loader` all have at least
some support (meaning, they work for the demo, without erroring, but I can guarantee
all of there possible features will work). Notably, I don't have any kind of
sourcemapping support, which would really be necessary to make this viable.

There are TODO's littered throughout the source code.
