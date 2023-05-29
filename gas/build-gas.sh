#/bin/bash
BASE_DIR="$(realpath $(dirname "$0"))"
cd $BASE_DIR
shopt -s globstar

if [ ! -d "binutils-gdb" ]; then
    git clone git://sourceware.org/git/binutils-gdb.git
fi
cd binutils-gdb
    git clean -fdx
    git reset --hard HEAD
    git checkout binutils-2_36
    git apply "$BASE_DIR/patch.patch"

    CONFIGURE_OPTIONS="--target=riscv32 --disable-debug --disable-dependency-tracking --disable-nls --disable-gdb --disable-libdecnumber --disable-readline --disable-sim"
    MAKE_OPTIONS="-j8 all-gas"

    mkdir buildnative
    cd buildnative/
        ../configure $CONFIGURE_OPTIONS
        make $MAKE_OPTIONS
    cd ..

    TRANSFER="
        bfd/doc/
    "
    for file in $TRANSFER; do
        mkdir -p $(dirname ./buildwasm/$file);
        cp -r ./buildnative/$file ./buildwasm/$file;
    done

    cd buildwasm
        emconfigure ../configure $CONFIGURE_OPTIONS
        emmake make $MAKE_OPTIONS
        emcc -Oz -s ENVIRONMENT=web -s EXPORT_ES6 -s FORCE_FILESYSTEM -s EXPORTED_RUNTIME_METHODS=FS **/*.o -o gas.js
    cd ..
cd ..

mkdir -p dist
cp binutils-gdb/buildwasm/gas.js binutils-gdb/buildwasm/gas.wasm dist/
