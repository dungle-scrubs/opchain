import Darwin
import Foundation
import Security

enum KeychainHelperError: Error {
    case usage(String)
    case unsupportedSubcommand(String)
    case missingAccount
    case missingSeparator
    case missingCommand
    case unsupportedFlag(String)
    case keychainFailure(OSStatus)
    case invalidSecretEncoding
    case executableNotFound(String)
}

extension KeychainHelperError: CustomStringConvertible {
    var description: String {
        switch self {
        case .usage(let message):
            return message
        case .unsupportedSubcommand(let subcommand):
            return "Unsupported subcommand: \(subcommand)"
        case .missingAccount:
            return "Missing required --account value."
        case .missingSeparator:
            return "Missing '--' before the command to execute."
        case .missingCommand:
            return "No command provided after '--'."
        case .unsupportedFlag(let flag):
            return "Unsupported flag: \(flag)"
        case .keychainFailure(let status):
            return "Keychain lookup failed with status \(status)."
        case .invalidSecretEncoding:
            return "Keychain item was not valid UTF-8 text."
        case .executableNotFound(let executable):
            return "Executable not found: \(executable)"
        }
    }
}

struct ExecRequest {
    let account: String
    let command: [String]
}

enum Command {
    case exec(ExecRequest)
    case token(account: String)
}

@main
struct KeychainHelperMain {
    static func main() {
        do {
            let command = try parseCommand(arguments: Array(CommandLine.arguments.dropFirst()))
            switch command {
            case .exec(let request):
                let token = try fetchToken(account: request.account)
                try execCommand(request.command, token: token)
            case .token(let account):
                let token = try fetchToken(account: account)
                FileHandle.standardOutput.write(Data("\(token)\n".utf8))
            }
        } catch let error {
            FileHandle.standardError.write(Data("Error: \(error)\n".utf8))
            Darwin.exit(1)
        }
    }

    /// Parse the command-line interface.
    /// - Parameter arguments: Command-line arguments excluding argv[0].
    /// - Returns: Parsed helper command.
    /// - Throws: `KeychainHelperError` when the input is invalid.
    static func parseCommand(arguments: [String]) throws(KeychainHelperError) -> Command {
        guard let subcommand = arguments.first else {
            throw .usage(usageText)
        }

        var remaining = Array(arguments.dropFirst())
        var account = ""

        while let first = remaining.first, first != "--" {
            if first == "--account" {
                guard remaining.count >= 2 else {
                    throw .missingAccount
                }
                account = remaining[1]
                remaining.removeFirst(2)
                continue
            }
            throw .unsupportedFlag(first)
        }

        guard !account.isEmpty else {
            throw .missingAccount
        }

        switch subcommand {
        case "exec":
            guard remaining.first == "--" else {
                throw .missingSeparator
            }
            let command = Array(remaining.dropFirst())
            guard !command.isEmpty else {
                throw .missingCommand
            }
            return .exec(ExecRequest(account: account, command: command))
        case "token":
            guard remaining.isEmpty else {
                throw .missingSeparator
            }
            return .token(account: account)
        default:
            throw .unsupportedSubcommand(subcommand)
        }
    }

    /// Fetch a service-account token from the Keychain.
    /// - Parameter account: Keychain account name.
    /// - Returns: Secret value as UTF-8 text.
    /// - Throws: `KeychainHelperError` when lookup fails.
    static func fetchToken(account: String) throws(KeychainHelperError) -> String {
        let query: [String: CFTypeRef] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "OP_SERVICE_ACCOUNT_TOKEN" as CFString,
            kSecAttrAccount as String: account as CFString,
            kSecReturnData as String: kCFBooleanTrue,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            throw .keychainFailure(status)
        }
        guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            throw .invalidSecretEncoding
        }
        return token
    }

    /// Replace the current process with the requested command.
    /// - Parameters:
    ///   - command: Command and argv list.
    ///   - token: Service-account token to export.
    /// - Throws: `KeychainHelperError` if exec preparation fails.
    static func execCommand(
        _ command: [String],
        token: String
    ) throws(KeychainHelperError) -> Never {
        guard let executable = resolvedExecutable(for: command[0]) else {
            throw .executableNotFound(command[0])
        }

        setenv("OP_SERVICE_ACCOUNT_TOKEN", token, 1)

        let argv = ([executable] + Array(command.dropFirst())).map { strdup($0) }
        defer {
            for pointer in argv {
                free(pointer)
            }
        }

        var execArguments = argv + [nil]
        execvp(executable, &execArguments)
        throw .executableNotFound(executable)
    }

    /// Resolve a command name to an executable path using PATH when needed.
    /// - Parameter command: The first argv element.
    /// - Returns: Absolute executable path when found.
    static func resolvedExecutable(for command: String) -> String? {
        if command.contains("/") {
            return FileManager.default.isExecutableFile(atPath: command) ? command : nil
        }

        let pathEntries = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        for entry in pathEntries {
            let candidate = URL(fileURLWithPath: entry)
                .appendingPathComponent(command)
                .path
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return nil
    }

    private static let usageText = "Usage: opchain-keychain-helper <exec|token> --account <account> [-- <command> [args...]]"
}
