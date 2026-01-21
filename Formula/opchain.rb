class Opchain < Formula
  desc "Run commands with OP_SERVICE_ACCOUNT_TOKEN from macOS Keychain"
  homepage "https://github.com/dungle-scrubs/opchain"
  url "https://github.com/dungle-scrubs/opchain/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "d57fed7a5e46c785decb8541e7b0c18a18569168db9f12c311bc81980242328f"
  license "MIT"

  depends_on :macos

  def install
    bin.install "opchain"
  end

  test do
    assert_match "USAGE", shell_output("#{bin}/opchain --help")
  end
end
