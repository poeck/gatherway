{
  description = "Gather Town Electron Wrapper";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "gather-linux";
          version = "1.0.6";

          # Use the current directory as the source
          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let relative = pkgs.lib.removePrefix (toString ./. + "/") (toString path);
              in builtins.elem relative [ "main.js" "package.json" "gather.desktop" "desktop" "assets" ]
                || pkgs.lib.hasPrefix "desktop/" relative
                || pkgs.lib.hasPrefix "assets/" relative;
          };

          nativeBuildInputs = [ pkgs.makeWrapper ];

          # No build needed (just copying files)
          dontBuild = true;

          installPhase = ''
            # 1. Create directory for app source
            mkdir -p $out/libexec/gather-linux
            mkdir -p $out/share/icons/hicolor/512x512/apps
            
            # 2. Copy the main files
            cp main.js package.json $out/libexec/gather-linux/
            cp -r desktop $out/libexec/gather-linux/
            # Copy the assets
            cp assets/icon.png $out/share/icons/hicolor/512x512/apps/gather-linux.png

            # 3. Create the binary wrapper
            # This creates a 'gather-electron' command that runs: 
            # electron /path/to/app --enable-features=WebRTCPipeWireCapturer
            makeWrapper ${pkgs.electron}/bin/electron $out/bin/gather-linux \
              --unset LD_LIBRARY_PATH \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.bluez ]} \
              --add-flags "$out/libexec/gather-linux" \
              --add-flags "--enable-features=WebRTCPipeWireCapturer"

            mkdir -p $out/share/applications
            cp gather.desktop $out/share/applications/
          '';
        };

        # This allows you to run `nix run` immediately
        apps.default = flake-utils.lib.mkApp {
          drv = self.packages.${system}.default;
        };

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 pkgs.electron pkgs.bluez ];
          # Inherited host libraries can conflict with Electron's pinned glibc.
          shellHook = ''
            unset LD_LIBRARY_PATH
          '';
        };
      }
    );
}
