(module
  ;; Hand-written SIMD scanning core. The host owns allocation and passes
  ;; non-overlapping source/output regions in this exported memory.
  (memory (export "memory") 2 4096)

  (global $keyword_code (mut i32) (i32.const 0))

  ;; Result header (all little-endian u32):
  ;;   status, count, cursor, error, abiVersion
  ;; Event record (24 bytes):
  ;;   kind, sourceStart, sourceEnd, aux0, aux1, flags
  (func (export "abi_version") (result i32)
    i32.const 1)

  (func (export "uses_simd") (result i32)
    i32.const 1)

  (func $write_result
    (param $result i32) (param $status i32) (param $count i32)
    (param $cursor i32) (param $error i32)
    local.get $result
    local.get $status
    i32.store
    local.get $result
    local.get $count
    i32.store offset=4
    local.get $result
    local.get $cursor
    i32.store offset=8
    local.get $result
    local.get $error
    i32.store offset=12
    local.get $result
    i32.const 1
    i32.store offset=16)

  (func $write_event
    (param $out i32) (param $index i32) (param $kind i32)
    (param $s i32) (param $e i32) (param $aux i32)
    (local $record i32)
    local.get $out
    local.get $index
    i32.const 24
    i32.mul
    i32.add
    local.tee $record
    local.get $kind
    i32.store
    local.get $record
    local.get $s
    i32.store offset=4
    local.get $record
    local.get $e
    i32.store offset=8
    local.get $record
    local.get $aux
    i32.store offset=12
    local.get $record
    i64.const 0
    i64.store offset=16)

  (func $find_eol
    (param $src i32) (param $pos i32) (param $end i32) (result i32)
    (local $v v128) (local $mask i32)
    (block $done
      (loop $vector
        local.get $pos
        i32.const 16
        i32.add
        local.get $end
        i32.gt_u
        br_if $done

        local.get $src
        local.get $pos
        i32.add
        v128.load
        local.tee $v
        i32.const 10
        i8x16.splat
        i8x16.eq
        local.get $v
        i32.const 13
        i8x16.splat
        i8x16.eq
        v128.or
        i8x16.bitmask
        local.tee $mask
        if
          local.get $pos
          local.get $mask
          i32.ctz
          i32.add
          return
        end

        local.get $pos
        i32.const 16
        i32.add
        local.set $pos
        br $vector))

    (block $tail_done
      (loop $tail
        local.get $pos
        local.get $end
        i32.ge_u
        br_if $tail_done
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        i32.const 10
        i32.eq
        if
          local.get $pos
          return
        end
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        i32.const 13
        i32.eq
        if
          local.get $pos
          return
        end
        local.get $pos
        i32.const 1
        i32.add
        local.set $pos
        br $tail))
    local.get $end)

  (func $find_byte
    (param $src i32) (param $pos i32) (param $end i32) (param $needle i32) (result i32)
    (local $v v128) (local $mask i32)
    (block $done
      (loop $vector
        local.get $pos
        i32.const 16
        i32.add
        local.get $end
        i32.gt_u
        br_if $done
        local.get $src
        local.get $pos
        i32.add
        v128.load
        local.tee $v
        local.get $needle
        i8x16.splat
        i8x16.eq
        i8x16.bitmask
        local.tee $mask
        if
          local.get $pos
          local.get $mask
          i32.ctz
          i32.add
          return
        end
        local.get $pos
        i32.const 16
        i32.add
        local.set $pos
        br $vector))
    (block $tail_done
      (loop $tail
        local.get $pos
        local.get $end
        i32.ge_u
        br_if $tail_done
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        local.get $needle
        i32.eq
        if
          local.get $pos
          return
        end
        local.get $pos
        i32.const 1
        i32.add
        local.set $pos
        br $tail))
    local.get $end)

  (func $is_ws (param $c i32) (result i32)
    local.get $c
    i32.const 32
    i32.eq
    local.get $c
    i32.const 9
    i32.eq
    i32.or
    local.get $c
    i32.const 11
    i32.eq
    i32.or
    local.get $c
    i32.const 12
    i32.eq
    i32.or)

  (func $is_nl (param $c i32) (result i32)
    local.get $c
    i32.const 10
    i32.eq
    local.get $c
    i32.const 13
    i32.eq
    i32.or)

  (func $is_digit (param $c i32) (result i32)
    local.get $c
    i32.const 48
    i32.ge_u
    local.get $c
    i32.const 57
    i32.le_u
    i32.and)

  (func $has_flag (param $flags i32) (param $mask i32) (result i32)
    local.get $flags
    local.get $mask
    i32.and
    i32.eqz
    i32.eqz)

  (func $is_hex (param $c i32) (result i32)
    local.get $c
    call $is_digit
    local.get $c
    i32.const 32
    i32.or
    i32.const 97
    i32.ge_u
    local.get $c
    i32.const 32
    i32.or
    i32.const 102
    i32.le_u
    i32.and
    i32.or)

  (func $to_lower_ascii (param $c i32) (result i32)
    local.get $c
    i32.const 65
    i32.ge_u
    local.get $c
    i32.const 90
    i32.le_u
    i32.and
    if (result i32)
      local.get $c
      i32.const 32
      i32.or
    else
      local.get $c
    end)

  (func $bitset_has (param $bits i32) (param $c i32) (result i32)
    local.get $bits
    local.get $c
    i32.const 3
    i32.shr_u
    i32.add
    i32.load8_u
    i32.const 1
    local.get $c
    i32.const 7
    i32.and
    i32.shl
    i32.and
    i32.eqz
    i32.eqz)

  (func $matches
    (param $src i32) (param $pos i32) (param $end i32)
    (param $needle i32) (param $length i32) (result i32)
    (local $i i32)
    local.get $pos
    local.get $length
    i32.add
    local.get $end
    i32.gt_u
    if
      i32.const 0
      return
    end
    (block $not_equal
      (loop $compare
        local.get $i
        local.get $length
        i32.ge_u
        if
          i32.const 1
          return
        end
        local.get $src
        local.get $pos
        i32.add
        local.get $i
        i32.add
        i32.load8_u
        local.get $needle
        local.get $i
        i32.add
        i32.load8_u
        i32.ne
        br_if $not_equal
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $compare))
    i32.const 0)

  (func $matches_lower
    (param $src i32) (param $s i32) (param $e i32)
    (param $needle i32) (param $length i32) (result i32)
    (local $i i32)
    local.get $e
    local.get $s
    i32.sub
    local.get $length
    i32.ne
    if
      i32.const 0
      return
    end
    (block $not_equal
      (loop $compare
        local.get $i
        local.get $length
        i32.ge_u
        if
          i32.const 1
          return
        end
        local.get $src
        local.get $s
        i32.add
        local.get $i
        i32.add
        i32.load8_u
        call $to_lower_ascii
        local.get $needle
        local.get $i
        i32.add
        i32.load8_u
        i32.ne
        br_if $not_equal
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $compare))
    i32.const 0)

  (func $scan_ws
    (param $src i32) (param $pos i32) (param $end i32) (result i32)
    (local $v v128) (local $mask i32)
    (block $done
      (loop $vector
        local.get $pos
        i32.const 16
        i32.add
        local.get $end
        i32.gt_u
        br_if $done
        local.get $src
        local.get $pos
        i32.add
        v128.load
        local.tee $v
        i32.const 32
        i8x16.splat
        i8x16.eq
        local.get $v
        i32.const 9
        i8x16.splat
        i8x16.eq
        v128.or
        local.get $v
        i32.const 11
        i8x16.splat
        i8x16.eq
        v128.or
        local.get $v
        i32.const 12
        i8x16.splat
        i8x16.eq
        v128.or
        i8x16.bitmask
        local.tee $mask
        i32.const 65535
        i32.ne
        if
          local.get $pos
          local.get $mask
          i32.const 65535
          i32.xor
          i32.ctz
          i32.add
          return
        end
        local.get $pos
        i32.const 16
        i32.add
        local.set $pos
        br $vector))
    (block $tail_done
      (loop $tail
        local.get $pos
        local.get $end
        i32.ge_u
        br_if $tail_done
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        call $is_ws
        i32.eqz
        br_if $tail_done
        local.get $pos
        i32.const 1
        i32.add
        local.set $pos
        br $tail))
    local.get $pos)

  (func $scan_default_ident
    (param $src i32) (param $pos i32) (param $end i32) (param $part i32) (result i32)
    (local $v v128) (local $mask v128) (local $bits i32)
    (block $done
      (loop $vector
        local.get $pos
        i32.const 16
        i32.add
        local.get $end
        i32.gt_u
        br_if $done
        local.get $src
        local.get $pos
        i32.add
        v128.load
        local.tee $v
        i32.const 65
        i8x16.splat
        i8x16.sub
        i32.const 25
        i8x16.splat
        i8x16.le_u
        local.get $v
        i32.const 97
        i8x16.splat
        i8x16.sub
        i32.const 25
        i8x16.splat
        i8x16.le_u
        v128.or
        local.get $v
        i32.const 36
        i8x16.splat
        i8x16.eq
        v128.or
        local.get $v
        i32.const 95
        i8x16.splat
        i8x16.eq
        v128.or
        local.set $mask
        local.get $part
        if
          local.get $mask
          local.get $v
          i32.const 48
          i8x16.splat
          i8x16.sub
          i32.const 9
          i8x16.splat
          i8x16.le_u
          v128.or
          local.set $mask
        end
        local.get $mask
        i8x16.bitmask
        local.tee $bits
        i32.const 65535
        i32.ne
        if
          local.get $pos
          local.get $bits
          i32.const 65535
          i32.xor
          i32.ctz
          i32.add
          return
        end
        local.get $pos
        i32.const 16
        i32.add
        local.set $pos
        br $vector))
    local.get $pos)

  (func $scan_ident
    (param $src i32) (param $pos i32) (param $end i32)
    (param $bits i32) (param $default i32) (result i32)
    local.get $default
    if
      local.get $src
      local.get $pos
      local.get $end
      i32.const 1
      call $scan_default_ident
      local.set $pos
    end
    (block $done
      (loop $tail
        local.get $pos
        local.get $end
        i32.ge_u
        br_if $done
        local.get $bits
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        call $bitset_has
        i32.eqz
        br_if $done
        local.get $pos
        i32.const 1
        i32.add
        local.set $pos
        br $tail))
    local.get $pos)

  ;; Emits line span events (kind 1), preserving the existing no-trailing-empty-line
  ;; contract. Status 1 means the host must drain and resume at result.cursor.
  (func (export "scan_lines")
    (param $src i32) (param $length i32) (param $cursor i32)
    (param $out i32) (param $capacity i32) (param $result i32) (result i32)
    (local $count i32) (local $eol i32) (local $next i32) (local $byte i32)
    local.get $capacity
    i32.eqz
    if
      local.get $result
      i32.const 2
      i32.const 0
      local.get $cursor
      i32.const 1
      call $write_result
      i32.const 2
      return
    end
    (block $done
      (loop $lines
        local.get $cursor
        local.get $length
        i32.ge_u
        br_if $done
        local.get $src
        local.get $cursor
        local.get $length
        call $find_eol
        local.set $eol
        local.get $out
        local.get $count
        i32.const 1
        local.get $cursor
        local.get $eol
        i32.const 0
        call $write_event
        local.get $count
        i32.const 1
        i32.add
        local.set $count

        local.get $eol
        local.set $next
        local.get $eol
        local.get $length
        i32.lt_u
        if
          local.get $src
          local.get $eol
          i32.add
          i32.load8_u
          local.set $byte
          local.get $eol
          i32.const 1
          i32.add
          local.set $next
          local.get $byte
          i32.const 13
          i32.eq
          local.get $next
          local.get $length
          i32.lt_u
          i32.and
          if
            local.get $src
            local.get $next
            i32.add
            i32.load8_u
            i32.const 10
            i32.eq
            if
              local.get $next
              i32.const 1
              i32.add
              local.set $next
            end
          end
        end
        local.get $next
        local.set $cursor

        local.get $count
        local.get $capacity
        i32.ge_u
        if
          local.get $cursor
          local.get $length
          i32.lt_u
          if
            local.get $result
            i32.const 1
            local.get $count
            local.get $cursor
            i32.const 0
            call $write_result
            i32.const 1
            return
          end
          br $done
        end
        br $lines))
    local.get $result
    i32.const 0
    local.get $count
    local.get $cursor
    i32.const 0
    call $write_result
    i32.const 0)

  (func $match_table_entry
    (param $src i32) (param $pos i32) (param $end i32)
    (param $table i32) (param $count i32) (param $stride i32) (result i32)
    (local $index i32) (local $record i32) (local $needle i32) (local $length i32)
    (block $none
      (loop $entries
        local.get $index
        local.get $count
        i32.ge_u
        br_if $none
        local.get $table
        local.get $index
        local.get $stride
        i32.mul
        i32.add
        local.tee $record
        i32.load
        local.set $needle
        local.get $record
        i32.load offset=4
        local.set $length
        local.get $src
        local.get $pos
        local.get $end
        local.get $needle
        local.get $length
        call $matches
        if
          local.get $record
          return
        end
        local.get $index
        i32.const 1
        i32.add
        local.set $index
        br $entries))
    i32.const 0)

  (func $keyword_lookup
    (param $src i32) (param $s i32) (param $e i32)
    (param $table i32) (param $count i32) (result i32)
    (local $index i32) (local $record i32)
    i32.const 0
    global.set $keyword_code
    (block $none
      (loop $entries
        local.get $index
        local.get $count
        i32.ge_u
        br_if $none
        local.get $table
        local.get $index
        i32.const 12
        i32.mul
        i32.add
        local.tee $record
        local.get $src
        local.get $s
        local.get $e
        local.get $record
        i32.load
        local.get $record
        i32.load offset=4
        call $matches_lower
        if
          local.get $record
          i32.load offset=8
          global.set $keyword_code
          i32.const 1
          return
        end
        local.get $index
        i32.const 1
        i32.add
        local.set $index
        br $entries))
    i32.const 0)

  (func $scan_number
    (param $src i32) (param $i i32) (param $n i32) (param $flags i32) (result i32)
    (local $j i32) (local $next i32) (local $c i32) (local $k i32)
    local.get $i
    local.set $j
    local.get $src
    local.get $i
    i32.add
    i32.load8_u
    i32.const 48
    i32.eq
    local.get $j
    i32.const 1
    i32.add
    local.get $n
    i32.lt_u
    i32.and
    if
      local.get $src
      local.get $j
      i32.const 1
      i32.add
      i32.add
      i32.load8_u
      local.set $next
      local.get $flags
      i32.const 1
      call $has_flag
      local.get $next
      i32.const 32
      i32.or
      i32.const 120
      i32.eq
      i32.and
      if
        local.get $j
        i32.const 2
        i32.add
        local.set $j
        (block $hex_done
          (loop $hex
            local.get $j
            local.get $n
            i32.ge_u
            br_if $hex_done
            local.get $src
            local.get $j
            i32.add
            i32.load8_u
            local.tee $c
            call $is_hex
            local.get $flags
            i32.const 8
            call $has_flag
            local.get $c
            i32.const 95
            i32.eq
            i32.and
            i32.or
            i32.eqz
            br_if $hex_done
            local.get $j
            i32.const 1
            i32.add
            local.set $j
            br $hex))
        local.get $j
        return
      end
      local.get $flags
      i32.const 2
      call $has_flag
      local.get $next
      i32.const 32
      i32.or
      i32.const 98
      i32.eq
      i32.and
      if
        local.get $j
        i32.const 2
        i32.add
        local.set $j
        (block $bin_done
          (loop $bin
            local.get $j
            local.get $n
            i32.ge_u
            br_if $bin_done
            local.get $src
            local.get $j
            i32.add
            i32.load8_u
            local.tee $c
            i32.const 48
            i32.eq
            local.get $c
            i32.const 49
            i32.eq
            i32.or
            local.get $flags
            i32.const 8
            call $has_flag
            local.get $c
            i32.const 95
            i32.eq
            i32.and
            i32.or
            i32.eqz
            br_if $bin_done
            local.get $j
            i32.const 1
            i32.add
            local.set $j
            br $bin))
        local.get $j
        return
      end
      local.get $flags
      i32.const 4
      call $has_flag
      local.get $next
      i32.const 32
      i32.or
      i32.const 111
      i32.eq
      i32.and
      if
        local.get $j
        i32.const 2
        i32.add
        local.set $j
        (block $oct_done
          (loop $oct
            local.get $j
            local.get $n
            i32.ge_u
            br_if $oct_done
            local.get $src
            local.get $j
            i32.add
            i32.load8_u
            local.tee $c
            i32.const 48
            i32.ge_u
            local.get $c
            i32.const 55
            i32.le_u
            i32.and
            local.get $flags
            i32.const 8
            call $has_flag
            local.get $c
            i32.const 95
            i32.eq
            i32.and
            i32.or
            i32.eqz
            br_if $oct_done
            local.get $j
            i32.const 1
            i32.add
            local.set $j
            br $oct))
        local.get $j
        return
      end
    end

    local.get $src
    local.get $i
    i32.add
    i32.load8_u
    i32.const 46
    i32.eq
    if
      local.get $j
      i32.const 1
      i32.add
      local.set $j
    end
    (block $digits_done
      (loop $digits
        local.get $j
        local.get $n
        i32.ge_u
        br_if $digits_done
        local.get $src
        local.get $j
        i32.add
        i32.load8_u
        local.tee $c
        call $is_digit
        local.get $flags
        i32.const 8
        call $has_flag
        local.get $c
        i32.const 95
        i32.eq
        i32.and
        i32.or
        i32.eqz
        br_if $digits_done
        local.get $j
        i32.const 1
        i32.add
        local.set $j
        br $digits))

    local.get $j
    local.get $n
    i32.lt_u
    if
      local.get $src
      local.get $j
      i32.add
      i32.load8_u
      i32.const 46
      i32.eq
      local.get $src
      local.get $i
      i32.add
      i32.load8_u
      i32.const 46
      i32.ne
      i32.and
      if
        local.get $j
        i32.const 1
        i32.add
        local.set $j
        (block $fraction_done
          (loop $fraction
            local.get $j
            local.get $n
            i32.ge_u
            br_if $fraction_done
            local.get $src
            local.get $j
            i32.add
            i32.load8_u
            local.tee $c
            call $is_digit
            local.get $flags
            i32.const 8
            call $has_flag
            local.get $c
            i32.const 95
            i32.eq
            i32.and
            i32.or
            i32.eqz
            br_if $fraction_done
            local.get $j
            i32.const 1
            i32.add
            local.set $j
            br $fraction))
      end
    end

    local.get $flags
    i32.const 32
    call $has_flag
    local.get $j
    local.get $n
    i32.lt_u
    i32.and
    if
      local.get $src
      local.get $j
      i32.add
      i32.load8_u
      i32.const 32
      i32.or
      i32.const 101
      i32.eq
      if
        local.get $j
        i32.const 1
        i32.add
        local.set $k
        local.get $k
        local.get $n
        i32.lt_u
        if
          local.get $src
          local.get $k
          i32.add
          i32.load8_u
          local.tee $c
          i32.const 43
          i32.eq
          local.get $c
          i32.const 45
          i32.eq
          i32.or
          if
            local.get $k
            i32.const 1
            i32.add
            local.set $k
          end
        end
        local.get $k
        local.get $n
        i32.lt_u
        if
          local.get $src
          local.get $k
          i32.add
          i32.load8_u
          call $is_digit
          if
            local.get $k
            i32.const 1
            i32.add
            local.set $j
            (block $exp_done
              (loop $exp
                local.get $j
                local.get $n
                i32.ge_u
                br_if $exp_done
                local.get $src
                local.get $j
                i32.add
                i32.load8_u
                local.tee $c
                call $is_digit
                local.get $flags
                i32.const 8
                call $has_flag
                local.get $c
                i32.const 95
                i32.eq
                i32.and
                i32.or
                i32.eqz
                br_if $exp_done
                local.get $j
                i32.const 1
                i32.add
                local.set $j
                br $exp))
          end
        end
      end
    end

    local.get $flags
    i32.const 16
    call $has_flag
    local.get $j
    local.get $n
    i32.lt_u
    i32.and
    if
      local.get $src
      local.get $j
      i32.add
      i32.load8_u
      i32.const 110
      i32.eq
      if
        local.get $j
        i32.const 1
        i32.add
        local.set $j
      end
    end
    local.get $j)

  (func $scan_string
    (param $src i32) (param $i i32) (param $n i32) (param $record i32) (result i32)
    (local $j i32) (local $c i32) (local $end_ptr i32)
    (local $end_len i32) (local $escape i32) (local $multiline i32)
    local.get $i
    local.get $record
    i32.load offset=4
    i32.add
    local.set $j
    local.get $record
    i32.load offset=8
    local.set $end_ptr
    local.get $record
    i32.load offset=12
    local.set $end_len
    local.get $record
    i32.load offset=16
    local.set $escape
    local.get $record
    i32.load offset=20
    local.set $multiline
    (block $done
      (loop $scan
        local.get $j
        local.get $n
        i32.ge_u
        br_if $done
        local.get $src
        local.get $j
        i32.add
        i32.load8_u
        local.set $c
        local.get $escape
        i32.const -1
        i32.ne
        local.get $c
        local.get $escape
        i32.eq
        i32.and
        if
          local.get $j
          i32.const 2
          i32.add
          local.tee $j
          local.get $n
          i32.gt_u
          if
            local.get $n
            local.set $j
          end
          br $scan
        end
        local.get $multiline
        i32.eqz
        local.get $c
        call $is_nl
        i32.and
        if
          local.get $j
          i32.const 1
          i32.add
          local.set $j
          br $done
        end
        local.get $src
        local.get $j
        local.get $n
        local.get $end_ptr
        local.get $end_len
        call $matches
        if
          local.get $j
          local.get $end_len
          i32.add
          local.set $j
          br $done
        end
        local.get $j
        i32.const 1
        i32.add
        local.set $j
        br $scan))
    local.get $j)

  (func $scan_block_comment
    (param $src i32) (param $i i32) (param $n i32) (param $record i32) (result i32)
    (local $j i32) (local $close_ptr i32) (local $close_len i32)
    local.get $i
    local.get $record
    i32.load offset=4
    i32.add
    local.set $j
    local.get $record
    i32.load offset=8
    local.set $close_ptr
    local.get $record
    i32.load offset=12
    local.set $close_len
    (block $done
      (loop $scan
        local.get $j
        local.get $close_len
        i32.add
        local.get $n
        i32.gt_u
        br_if $done
        local.get $src
        local.get $j
        local.get $n
        local.get $close_ptr
        local.get $close_len
        call $matches
        if
          local.get $j
          local.get $close_len
          i32.add
          return
        end
        local.get $src
        local.get $j
        i32.const 1
        i32.add
        local.get $n
        local.get $close_ptr
        i32.load8_u
        call $find_byte
        local.set $j
        br $scan))
    local.get $n)

  (func $can_start_regex
    (param $enabled i32) (param $prev_type i32) (param $prev_code i32)
    (param $last_sig i32) (param $last_two i32) (result i32)
    local.get $enabled
    i32.eqz
    if
      i32.const 0
      return
    end
    local.get $last_sig
    i32.const 60
    i32.eq
    local.get $last_sig
    i32.const 62
    i32.eq
    i32.or
    if
      i32.const 0
      return
    end
    local.get $prev_type
    i32.const -1
    i32.eq
    if
      i32.const 1
      return
    end
    local.get $prev_type
    i32.const 2
    i32.eq
    local.get $prev_type
    i32.const 4
    i32.eq
    i32.or
    local.get $prev_type
    i32.const 5
    i32.eq
    i32.or
    local.get $prev_type
    i32.const 6
    i32.eq
    i32.or
    local.get $prev_type
    i32.const 8
    i32.eq
    i32.or
    local.get $prev_type
    i32.const 0
    i32.eq
    i32.or
    local.get $prev_type
    i32.const 1
    i32.eq
    i32.or
    if
      i32.const 0
      return
    end
    local.get $prev_type
    i32.const 3
    i32.eq
    if
      i32.const 1
      return
    end
    local.get $prev_type
    i32.const 9
    i32.eq
    if
      local.get $last_sig
      i32.const 41
      i32.eq
      local.get $last_sig
      i32.const 93
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 125
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 44
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 59
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 58
      i32.eq
      i32.or
      return
    end
    local.get $prev_type
    i32.const 10
    i32.eq
    if
      local.get $last_sig
      i32.const 43
      i32.eq
      local.get $last_sig
      i32.const 45
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 42
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 47
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 37
      i32.eq
      i32.or
      if
        i32.const 0
        return
      end
      local.get $last_sig
      i32.const 61
      i32.eq
      local.get $last_sig
      i32.const 33
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 63
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 124
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 38
      i32.eq
      i32.or
      local.get $last_sig
      i32.const 94
      i32.eq
      i32.or
      if
        i32.const 1
        return
      end
      local.get $last_two
      i32.const 11051
      i32.eq
      local.get $last_two
      i32.const 11565
      i32.eq
      i32.or
      if
        i32.const 0
        return
      end
      i32.const 1
      return
    end
    i32.const 1)

  (func $scan_regex
    (param $src i32) (param $i i32) (param $n i32) (result i32)
    (local $j i32) (local $x i32) (local $in_class i32)
    local.get $i
    i32.const 1
    i32.add
    local.set $j
    (block $body_done
      (loop $body
        local.get $j
        local.get $n
        i32.ge_u
        br_if $body_done
        local.get $src
        local.get $j
        i32.add
        i32.load8_u
        local.set $x
        local.get $j
        i32.const 1
        i32.add
        local.set $j
        local.get $x
        i32.const 92
        i32.eq
        if
          local.get $j
          local.get $n
          i32.lt_u
          if
            local.get $j
            i32.const 1
            i32.add
            local.set $j
          end
          br $body
        end
        local.get $x
        i32.const 91
        i32.eq
        if
          i32.const 1
          local.set $in_class
          br $body
        end
        local.get $x
        i32.const 93
        i32.eq
        if
          i32.const 0
          local.set $in_class
          br $body
        end
        local.get $x
        i32.const 47
        i32.eq
        local.get $in_class
        i32.eqz
        i32.and
        br_if $body_done
        local.get $x
        call $is_nl
        br_if $body_done
        br $body))
    (block $flags_done
      (loop $flags
        local.get $j
        local.get $n
        i32.ge_u
        br_if $flags_done
        local.get $src
        local.get $j
        i32.add
        i32.load8_u
        local.tee $x
        i32.const 32
        i32.or
        i32.const 97
        i32.ge_u
        local.get $x
        i32.const 32
        i32.or
        i32.const 122
        i32.le_u
        i32.and
        i32.eqz
        br_if $flags_done
        local.get $j
        i32.const 1
        i32.add
        local.set $j
        br $flags))
    local.get $j)

  (func $emit_token
    (param $out i32) (param $index i32) (param $src i32) (param $state i32)
    (param $type i32) (param $s i32) (param $e i32) (param $meta i32)
    local.get $out
    local.get $index
    i32.const 512
    local.get $type
    i32.add
    local.get $s
    local.get $e
    local.get $meta
    call $write_event
    local.get $type
    i32.const 0
    i32.ne
    if
      local.get $state
      local.get $type
      i32.store
      local.get $state
      local.get $type
      i32.const 3
      i32.eq
      if (result i32)
        local.get $meta
      else
        i32.const 0
      end
      i32.store offset=4
    end
    local.get $type
    i32.const 1
    i32.eq
    if
      local.get $state
      i32.const 1
      i32.store
      local.get $state
      i64.const 0
      i64.store offset=4
      local.get $state
      i32.const 0
      i32.store offset=12
      return
    end
    local.get $type
    i32.const 0
    i32.ne
    local.get $type
    i32.const 7
    i32.ne
    i32.and
    if
      local.get $state
      local.get $src
      local.get $e
      i32.const 1
      i32.sub
      i32.add
      i32.load8_u
      i32.store offset=8
      local.get $state
      local.get $state
      i32.load offset=12
      i32.const 255
      i32.and
      i32.const 8
      i32.shl
      local.get $state
      i32.load offset=8
      i32.or
      i32.store offset=12
    end)

  ;; Generic data-driven syntax tokenizer. Configuration layout is documented in
  ;; src/wasm/core.ts. It mirrors CompiledLanguageSpec without JS callbacks in
  ;; the scanning state machine. Template literals use the scalar fallback for
  ;; now; the host only dispatches compatible profiles to this entrypoint.
  (func (export "tokenize")
    (param $src i32) (param $length i32) (param $cursor i32) (param $config i32)
    (param $out i32) (param $capacity i32) (param $state i32) (param $result i32)
    (result i32)
    (local $count i32) (local $s i32) (local $e i32) (local $c i32)
    (local $type i32) (local $meta i32) (local $record i32)
    (local $a i32) (local $b i32) (local $two i32) (local $three i32)
    local.get $capacity
    i32.eqz
    if
      local.get $result
      i32.const 2
      i32.const 0
      local.get $cursor
      i32.const 1
      call $write_result
      i32.const 2
      return
    end
    (block $done
      (loop $tokens
        local.get $cursor
        local.get $length
        i32.ge_u
        br_if $done
        local.get $count
        local.get $capacity
        i32.ge_u
        if
          local.get $result
          i32.const 1
          local.get $count
          local.get $cursor
          i32.const 0
          call $write_result
          i32.const 1
          return
        end

        local.get $cursor
        local.set $s
        local.get $src
        local.get $cursor
        i32.add
        i32.load8_u
        local.set $c

        (block $classified
        local.get $cursor
        i32.eqz
        local.get $length
        i32.const 1
        i32.gt_u
        i32.and
        local.get $c
        i32.const 35
        i32.eq
        i32.and
        if
          local.get $src
          i32.const 1
          i32.add
          i32.load8_u
          i32.const 33
          i32.eq
          if
            local.get $src
            i32.const 2
            local.get $length
            call $find_eol
            local.set $e
            i32.const 7
            local.set $type
            br $classified
          end
        end

        local.get $c
        call $is_ws
        if
          local.get $src
          local.get $cursor
          local.get $length
          call $scan_ws
          local.set $e
          i32.const 0
          local.set $type
        else
          local.get $c
          call $is_nl
          if
            local.get $cursor
            i32.const 1
            i32.add
            local.set $e
            local.get $c
            i32.const 13
            i32.eq
            local.get $e
            local.get $length
            i32.lt_u
            i32.and
            if
              local.get $src
              local.get $e
              i32.add
              i32.load8_u
              i32.const 10
              i32.eq
              if
                local.get $e
                i32.const 1
                i32.add
                local.set $e
              end
            end
            i32.const 1
            local.set $type
          else
            local.get $src
            local.get $cursor
            local.get $length
            local.get $config
            i32.load offset=20
            local.get $config
            i32.load offset=16
            i32.const 8
            call $match_table_entry
            local.tee $record
            if
              local.get $src
              local.get $cursor
              local.get $record
              i32.load offset=4
              i32.add
              local.get $length
              call $find_eol
              local.set $e
              i32.const 7
              local.set $type
            else
              local.get $src
              local.get $cursor
              local.get $length
              local.get $config
              i32.load offset=28
              local.get $config
              i32.load offset=24
              i32.const 16
              call $match_table_entry
              local.tee $record
              if
                local.get $src
                local.get $cursor
                local.get $length
                local.get $record
                call $scan_block_comment
                local.set $e
                i32.const 7
                local.set $type
              else
                local.get $config
                i32.load
                local.get $c
                call $bitset_has
                if
                  local.get $src
                  local.get $cursor
                  i32.const 1
                  i32.add
                  local.get $length
                  local.get $config
                  i32.load offset=4
                  local.get $config
                  i32.load offset=68
                  call $scan_ident
                  local.set $e
                  local.get $src
                  local.get $cursor
                  local.get $e
                  local.get $config
                  i32.load offset=12
                  local.get $config
                  i32.load offset=8
                  call $keyword_lookup
                  if
                    i32.const 3
                    local.set $type
                    global.get $keyword_code
                    local.set $meta
                  else
                    i32.const 2
                    local.set $type
                  end
                else
                  local.get $c
                  call $is_digit
                  local.get $c
                  i32.const 46
                  i32.eq
                  local.get $config
                  i32.load offset=40
                  i32.const 64
                  i32.and
                  i32.eqz
                  i32.eqz
                  i32.and
                  local.get $cursor
                  i32.const 1
                  i32.add
                  local.get $length
                  i32.lt_u
                  i32.and
                  if (result i32)
                    local.get $src
                    local.get $cursor
                    i32.const 1
                    i32.add
                    i32.add
                    i32.load8_u
                    call $is_digit
                  else
                    i32.const 0
                  end
                  i32.or
                  if
                    local.get $src
                    local.get $cursor
                    local.get $length
                    local.get $config
                    i32.load offset=40
                    call $scan_number
                    local.set $e
                    i32.const 4
                    local.set $type
                  else
                    local.get $src
                    local.get $cursor
                    local.get $length
                    local.get $config
                    i32.load offset=36
                    local.get $config
                    i32.load offset=32
                    i32.const 24
                    call $match_table_entry
                    local.tee $record
                    if
                      local.get $src
                      local.get $cursor
                      local.get $length
                      local.get $record
                      call $scan_string
                      local.set $e
                      i32.const 5
                      local.set $type
                    else
                      local.get $c
                      i32.const 47
                      i32.eq
                      if
                        local.get $config
                        i32.load offset=44
                        local.get $state
                        i32.load
                        local.get $state
                        i32.load offset=4
                        local.get $state
                        i32.load offset=8
                        local.get $state
                        i32.load offset=12
                        call $can_start_regex
                        if
                          local.get $src
                          local.get $cursor
                          local.get $length
                          call $scan_regex
                          local.set $e
                          i32.const 8
                          local.set $type
                        end
                      end
                      local.get $e
                      i32.eqz
                      if
                        local.get $cursor
                        i32.const 1
                        i32.add
                        local.set $e
                        local.get $c
                        local.set $a
                        local.get $e
                        local.get $length
                        i32.lt_u
                        if (result i32)
                          local.get $src
                          local.get $e
                          i32.add
                          i32.load8_u
                        else
                          i32.const 0
                        end
                        local.set $b
                        local.get $a
                        i32.const 8
                        i32.shl
                        local.get $b
                        i32.or
                        local.set $two
                        local.get $e
                        i32.const 1
                        i32.add
                        local.get $length
                        i32.lt_u
                        if (result i32)
                          local.get $src
                          local.get $e
                          i32.const 1
                          i32.add
                          i32.add
                          i32.load8_u
                        else
                          i32.const 0
                        end
                        local.set $c
                        local.get $two
                        i32.const 8
                        i32.shl
                        local.get $c
                        i32.or
                        local.set $three
                        local.get $three
                        i32.const 4013373
                        i32.eq
                        local.get $three
                        i32.const 2178365
                        i32.eq
                        i32.or
                        local.get $three
                        i32.const 4079166
                        i32.eq
                        i32.or
                        local.get $three
                        i32.const 4079165
                        i32.eq
                        i32.or
                        local.get $three
                        i32.const 3947581
                        i32.eq
                        i32.or
                        if
                          local.get $e
                          i32.const 2
                          i32.add
                          local.tee $e
                          local.get $length
                          i32.gt_u
                          if
                            local.get $length
                            local.set $e
                          end
                          i32.const 10
                          local.set $type
                        else
                          local.get $two
                          i32.const 11051
                          i32.eq
                          local.get $two
                          i32.const 11565
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 15677
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 8509
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 9766
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 31868
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 10813
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 12093
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 9533
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 11069
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 11581
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 9789
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 31805
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 24125
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 15420
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 15934
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 16186
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 11822
                          i32.eq
                          i32.or
                          local.get $two
                          i32.const 15678
                          i32.eq
                          i32.or
                          if
                            local.get $e
                            i32.const 1
                            i32.add
                            local.tee $e
                            local.get $length
                            i32.gt_u
                            if
                              local.get $length
                              local.set $e
                            end
                            i32.const 10
                            local.set $type
                          else
                            local.get $a
                            i32.const 43
                            i32.eq
                            local.get $a
                            i32.const 45
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 42
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 47
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 37
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 61
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 33
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 63
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 124
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 38
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 94
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 126
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 60
                            i32.eq
                            i32.or
                            local.get $a
                            i32.const 62
                            i32.eq
                            i32.or
                            if (result i32)
                              i32.const 10
                            else
                              local.get $a
                              i32.const 40
                              i32.eq
                              local.get $a
                              i32.const 41
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 91
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 93
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 123
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 125
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 44
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 59
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 58
                              i32.eq
                              i32.or
                              local.get $a
                              i32.const 46
                              i32.eq
                              i32.or
                              if (result i32)
                                i32.const 9
                              else
                                i32.const 10
                              end
                            end
                            local.set $type
                          end
                        end
                      end
                    end
                  end
                end
              end
            end
          end
        end)

        local.get $out
        local.get $count
        local.get $src
        local.get $state
        local.get $type
        local.get $s
        local.get $e
        local.get $meta
        call $emit_token
        local.get $e
        local.set $cursor
        local.get $count
        i32.const 1
        i32.add
        local.set $count
        i32.const 0
        local.set $e
        i32.const 0
        local.set $meta
        br $tokens))

    local.get $result
    i32.const 0
    local.get $count
    local.get $cursor
    i32.const 0
    call $write_result
    i32.const 0)
)
