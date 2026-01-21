class Opchain < Formula
  desc "Run commands with OP_SERVICE_ACCOUNT_TOKEN from macOS Keychain"
  homepage "https://github.com/dungle-scrubs/opchain"
  url "https://github.com/dungle-scrubs/opchain/archive/refs/tags/v0.2.0.tar.gz"
  sha256 "18a5ecb44ada56f3207da694d4f08b0df46c2a0868266997c293132dac8dddfe"
  license "MIT"

  depends_on :macos

  def install
    bin.install "opchain"
  end

  test do
    assert_match "USAGE", shell_output("#{bin}/opchain --help")
  end
end
