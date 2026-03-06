"""CLI entry point for the OpenCascade.js binding generator.

Usage:
    python -m ocjs_bindgen --config bindgen-filters.yaml
    python -m ocjs_bindgen --config bindgen-filters.yaml --custom-code "typedef ..." --custom-only
"""

import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser(
        prog="ocjs-bindgen",
        description="Generate Embind C++ and TypeScript bindings from OCCT headers",
    )
    parser.add_argument(
        "--config", "-c",
        default=None,
        help="Path to bindgen-filters.yaml (default: $OCJS_BINDGEN_CONFIG or auto-detect)",
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output directory for generated bindings (default: $OCJS_ROOT/build/bindings)",
    )
    parser.add_argument(
        "--custom-code",
        default="",
        help="Additional C++ code (e.g. Handle typedefs) to parse",
    )
    parser.add_argument(
        "--custom-only",
        action="store_true",
        help="Only generate bindings for custom code (skip OCCT headers)",
    )
    parser.add_argument(
        "--no-deprecated",
        action="store_true",
        help="Exclude all deprecated OCCT symbols regardless of YAML config",
    )
    args = parser.parse_args()

    from ocjs_bindgen.config import get_config
    config = get_config(args.config)

    if args.no_deprecated:
        config.set_no_deprecated()

    # Patch filter functions BEFORE importing generateBindings / bindings / Common,
    # because those modules bind filter functions at import time.
    from ocjs_bindgen import filters
    filters.install(config)

    src_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if src_dir not in sys.path:
        sys.path.insert(0, src_dir)

    import generateBindings

    # Merge template typedef exclusions from config into the hardcoded set
    if config.excluded_template_typedefs:
        generateBindings._FILTERED_TEMPLATE_TYPEDEFS = (
            generateBindings._FILTERED_TEMPLATE_TYPEDEFS | config.excluded_template_typedefs
        )

    if args.output:
        generateBindings.libraryBasePath = args.output
        generateBindings.buildDirectory = os.path.dirname(args.output)

    if args.custom_only and args.custom_code:
        generateBindings.generateCustomCodeBindings(args.custom_code)
    else:
        _run_full_pipeline(generateBindings)

    print("Binding generation complete.", flush=True)


def _run_full_pipeline(gen):
    """Run the full binding generation pipeline."""
    from Common import ocIncludeStatements
    from TuInfo import TuInfo

    os.makedirs(gen.libraryBasePath, exist_ok=True)

    tuInfo = TuInfo("")
    embindPreamble = ocIncludeStatements + "\n" + gen.referenceTypeTemplateDefs

    gen.process(
        tuInfo, ".cpp",
        gen.embindGenerationFuncClasses,
        gen.embindGenerationFuncTemplates,
        gen.embindGenerationFuncEnums,
        embindPreamble, False,
    )
    gen.process(
        tuInfo, ".d.ts.json",
        gen.typescriptGenerationFuncClasses,
        gen.typescriptGenerationFuncTemplates,
        gen.typescriptGenerationFuncEnums,
        "", False,
    )


if __name__ == "__main__":
    main()
