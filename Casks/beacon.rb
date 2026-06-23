# Homebrew cask for Beacon.
#
# Publish this in a tap repo named "Marcussy34/homebrew-beacon" (file path: Casks/beacon.rb),
# then users install with:  brew install --cask marcussy34/beacon/beacon
#
# After each GitHub release, bump `version` and replace both sha256 values with the real
# checksums:  shasum -a 256 Beacon-<version>-arm64.dmg  (and the x64 dmg).
cask "beacon" do
  version "0.1.0"

  on_arm do
    sha256 "REPLACE_WITH_ARM64_DMG_SHA256"
    url "https://github.com/Marcussy34/beacon/releases/download/v#{version}/Beacon-#{version}-arm64.dmg"
  end
  on_intel do
    sha256 "REPLACE_WITH_X64_DMG_SHA256"
    url "https://github.com/Marcussy34/beacon/releases/download/v#{version}/Beacon-#{version}-x64.dmg"
  end

  name "Beacon"
  desc "Menu-bar watcher for Claude Code and Codex CLI sessions across all your repos"
  homepage "https://github.com/Marcussy34/beacon"

  depends_on macos: ">= :monterey"

  app "Beacon.app"

  caveats <<~EOS
    Beacon is a menu-bar app — it has no Dock icon. Look for its icon in the menu bar.

    On first launch Beacon:
      • installs its hooks into ~/.claude and ~/.codex (merged, never overwritten), and
      • asks for macOS Automation permission so "Go to" can focus your terminal/editor.

    For Codex, approve Beacon's hooks via Codex's `/hooks` trust review.
  EOS
end
